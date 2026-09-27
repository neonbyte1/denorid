import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import { Buffer } from "node:buffer";
import { Server } from "../server.ts";
import { closeQuietly, connectWithRetry } from "./_connection.ts";
import { RmqDeserializer } from "./deserializer.ts";
import type { RmqOptions } from "./options.ts";
import { RmqSerializer } from "./serializer.ts";

/** Reply body and its AMQP `contentType` (none for JSON error replies). */
interface Reply {
  content: Buffer;
  contentType?: string;
}

/**
 * Microservice server using RabbitMQ via amqplib.
 *
 * Consumes messages from the configured queue. Pattern is read from
 * `msg.properties.headers["pattern"]`. Request-response messages carry
 * `correlationId` and `replyTo` properties; events do not.
 */
export class RmqServer extends Server<RmqOptions> {
  private connection?: ChannelModel;
  private channel?: Channel;
  private consumerTag?: string;
  private closing = false;
  private stopped?: PromiseWithResolvers<void>;
  private readonly inFlight: Set<Promise<void>> = new Set();
  private readonly serializer = new RmqSerializer();
  private readonly deserializer = new RmqDeserializer();

  /**
   * Connects, sets up the queue (and exchange binding) and consumes it.
   *
   * Resolves once {@link close} shut the server down. Rejects when setup fails
   * (the connection is closed first) or when the broker closes the connection
   * or the consumer channel while the server is not closing.
   *
   * @return {Promise<void>}
   */
  public override async listen(): Promise<void> {
    const connection = await connectWithRetry(this.options);
    const stopped = Promise.withResolvers<void>();

    // Awaited only after setup; keeps a drop during setup from surfacing as
    // an unhandled rejection (setup itself rejects then).
    stopped.promise.catch(() => {});
    this.stopped = stopped;
    this.connection = connection;

    // Attached before any other call: amqplib rethrows `error` events nobody
    // listens to, crashing the process.
    connection.on("error", (err: Error) => {
      this.logger.error("RMQ connection error", err);
    });
    connection.once("close", (cause?: Error) => {
      if (!this.closing) {
        stopped.reject(
          new Error("RMQ connection closed unexpectedly", { cause }),
        );
      }
    });

    try {
      const channel = await connection.createChannel();

      this.channel = channel;
      channel.on("error", (err: Error) => {
        this.logger.error("RMQ channel error", err);
      });
      channel.once("close", () => {
        if (this.closing) {
          return;
        }

        // Deferred: when the whole connection drops, amqplib closes its
        // channels first; the connection `close` (with its cause) wins then.
        queueMicrotask(() => {
          stopped.reject(new Error("RMQ channel closed unexpectedly"));
          void closeQuietly(connection);
        });
      });

      const queue = await this.setupQueue(channel);
      const { consumerTag } = await channel.consume(
        queue,
        (msg) => {
          if (msg === null) {
            return;
          }

          const task = this.handleMessage(channel, msg);

          this.inFlight.add(task);
          void task.finally(() => this.inFlight.delete(task));
        },
        {
          noAck: this.options.noAck ?? false,
          consumerTag: this.options.consumerTag,
        },
      );

      this.consumerTag = consumerTag;
      this.logger.log(`RMQ server listening on queue "${queue}"`);
    } catch (err) {
      await closeQuietly(connection);
      throw err;
    }

    await stopped.promise;
  }

  /**
   * Cancels the consumer, waits for in-flight messages to be handled (replied
   * and acked), then closes channel and connection and resolves {@link listen}.
   *
   * @return {Promise<void>}
   */
  public override async close(): Promise<void> {
    const { connection, channel, consumerTag, stopped } = this;

    this.closing = true;
    this.connection = undefined;
    this.channel = undefined;
    this.consumerTag = undefined;

    if (consumerTag) {
      try {
        await channel!.cancel(consumerTag);
        // deno-lint-ignore no-empty
      } catch {}
    }

    await Promise.all(this.inFlight);
    await closeQuietly(channel);
    await closeQuietly(connection);

    stopped?.resolve();
    this.closing = false;
  }

  private async setupQueue(channel: Channel): Promise<string> {
    const queue = this.options.queue ?? "denorid";
    let actualQueue = queue;

    if (!this.options.noAssert) {
      const queueResponse = await channel.assertQueue(queue, {
        durable: this.options.queueOptions?.durable ?? true,
        ...this.options.queueOptions,
      });
      actualQueue = queueResponse.queue;
    }

    if (this.options.prefetchCount != null) {
      await channel.prefetch(
        this.options.prefetchCount,
        this.options.isGlobalPrefetchCount,
      );
    }

    if (this.options.exchange) {
      if (!this.options.noAssert) {
        await channel.assertExchange(
          this.options.exchange,
          this.options.exchangeType ?? "direct",
          {
            durable: this.options.exchangeOptions?.durable ?? true,
            internal: this.options.exchangeOptions?.internal,
            autoDelete: this.options.exchangeOptions?.autoDelete,
            alternateExchange: this.options.exchangeOptions?.alternateExchange,
            arguments: this.options.exchangeOptions?.arguments,
          },
        );
      }

      await channel.bindQueue(
        actualQueue,
        this.options.exchange,
        this.options.routingKey ?? "",
      );
    }

    return actualQueue;
  }

  /**
   * Handles one delivery on the channel it was consumed from. Never rejects:
   * every failure is logged, answered (request-response) and nacked.
   */
  private async handleMessage(
    channel: Channel,
    msg: ConsumeMessage,
  ): Promise<void> {
    const headers = msg.properties.headers as Record<string, unknown>;
    const pattern = String(headers?.["pattern"] ?? "");
    const isRequestResponse = Boolean(
      msg.properties.correlationId && msg.properties.replyTo,
    );
    let data: unknown;

    try {
      data = (this.deserializer.deserialize(msg.content) as { data: unknown })
        .data;
    } catch (err) {
      this.logger.error("Failed to deserialize RMQ message", err);
      this.settle(
        channel,
        msg,
        false,
        isRequestResponse
          ? errorReply(`Failed to deserialize message: ${messageOf(err)}`)
          : undefined,
      );
      return;
    }

    let response: unknown;

    try {
      response = await this.dispatch(pattern, data);
    } catch (err) {
      // `dispatch` already routed the error to the exception handler / logger.
      this.settle(
        channel,
        msg,
        false,
        isRequestResponse ? errorReply(messageOf(err)) : undefined,
      );
      return;
    }

    let reply: Reply | undefined;

    if (isRequestResponse) {
      try {
        reply = {
          content: Buffer.from(this.serializer.serialize(response)),
          contentType: this.serializer.contentTypeFor(response),
        };
      } catch (err) {
        // The handler succeeded; nacking would dead-letter a processed message.
        this.logger.error("Failed to serialize RMQ response", err);
        reply = errorReply(
          `Failed to serialize response: ${messageOf(err)}`,
        );
      }
    }

    this.settle(channel, msg, true, reply);
  }

  /**
   * Sends `reply` (if any) and acks (`success`) or nacks without requeue,
   * unless `noAck` is set. Failures (e.g. a channel closed meanwhile) are
   * logged, never thrown.
   */
  private settle(
    channel: Channel,
    msg: ConsumeMessage,
    success: boolean,
    reply: Reply | undefined,
  ): void {
    if (reply) {
      try {
        channel.sendToQueue(msg.properties.replyTo as string, reply.content, {
          correlationId: msg.properties.correlationId as string,
          contentType: reply.contentType,
        });
      } catch (err) {
        this.logger.error("Failed to send RMQ reply", err);
      }
    }

    if (this.options.noAck) {
      return;
    }

    try {
      if (success) {
        channel.ack(msg);
      } else {
        channel.nack(msg, false, false);
      }
    } catch (err) {
      this.logger.error("Failed to acknowledge RMQ message", err);
    }
  }
}

function errorReply(err: string): Reply {
  return { content: Buffer.from(JSON.stringify({ err })) };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
