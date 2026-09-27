import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import { Buffer } from "node:buffer";
import { Server } from "../server.ts";
import { closeQuietly, connectWithRetry, delay } from "./_connection.ts";
import { RmqDeserializer } from "./deserializer.ts";
import type { RmqOptions } from "./options.ts";
import { RmqSerializer } from "./serializer.ts";

/** Reply body and its AMQP `contentType` (none for JSON error replies). */
interface Reply {
  content: Buffer;
  contentType?: string;
}

/** A connection whose consumer channel is set up and consuming. */
interface ServerSession {
  connection: ChannelModel;
  channel: Channel;
  consumerTag: string;
}

/**
 * Microservice server using RabbitMQ via amqplib.
 *
 * Consumes messages from the configured queue. Pattern is read from
 * `msg.properties.headers["pattern"]`. Request-response messages carry
 * `correlationId` and `replyTo` properties; events do not.
 *
 * When the broker closes the connection or the consumer channel after
 * startup, the server logs it, closes the connection and sets itself up
 * again: one connection attempt every `retryDelay` ms (default `1000`) until
 * it consumes again or {@link close} is called. Failed attempts are logged.
 */
export class RmqServer extends Server<RmqOptions> {
  /** The running session; unset while (re)connecting and once closed. */
  private session?: ServerSession;
  /** Aborted by `close()` to stop a pending start or reconnect. */
  private lifecycle?: AbortController;
  /** The latest start or reconnect; never rejects. `close()` waits for it. */
  private connecting?: Promise<void>;
  private readonly inFlight: Set<Promise<void>> = new Set();
  private readonly serializer = new RmqSerializer();
  private readonly deserializer = new RmqDeserializer();

  /**
   * Connects (up to `maxConnectionAttempts` attempts, `retryDelay` ms apart),
   * sets up the queue (and exchange binding) and consumes it. Once started,
   * the server reconnects by itself after the broker dropped it (see
   * {@link RmqServer}).
   *
   * @return {Promise<void>} Resolves once the consumer runs (or once
   * {@link close} stopped the pending start), rejects when connecting or the
   * setup fails, after the connection was closed.
   */
  public override async listen(): Promise<void> {
    const lifecycle = new AbortController();

    this.lifecycle = lifecycle;

    const starting = this.open(this.options, lifecycle.signal);

    this.connecting = starting.catch(() => {});

    try {
      await starting;
    } catch (err) {
      // `close()` stopped the start, which closed what it opened.
      if (!lifecycle.signal.aborted) {
        throw err;
      }
    }
  }

  /**
   * Stops a pending start or reconnect (a connection it gets afterwards is
   * closed before this resolves), cancels the consumer, waits for in-flight
   * messages to be handled (replied and acked), then closes channel and
   * connection. Safe to call before, during and after {@link listen}.
   *
   * @return {Promise<void>}
   */
  public override async close(): Promise<void> {
    const { lifecycle, connecting } = this;

    lifecycle?.abort();
    this.lifecycle = undefined;
    this.connecting = undefined;

    // A stopped (re)connect closes what it opened; one whose consumer already
    // started leaves its session to this call.
    await connecting;

    const { session } = this;

    // Unset first, so the close events of this session are ignored.
    this.session = undefined;

    if (session) {
      try {
        await session.channel.cancel(session.consumerTag);
        // deno-lint-ignore no-empty
      } catch {}
    }

    await Promise.all(this.inFlight);
    await closeQuietly(session?.channel);
    await closeQuietly(session?.connection);
  }

  /**
   * Connects with `connectOptions` and sets up one session: consumer channel,
   * queue topology, consumer. Publishes it once the consumer runs, even when
   * `signal` aborted meanwhile (`close()` shuts it down then). Closes the
   * connection and rethrows when a step fails or `signal` aborted earlier.
   */
  private async open(
    connectOptions: RmqOptions,
    signal: AbortSignal,
  ): Promise<void> {
    const connection = await connectWithRetry(connectOptions, signal);

    // Attached before any other call: amqplib rethrows `error` events nobody
    // listens to, crashing the process.
    connection.on("error", (err: Error) => {
      this.logger.error("RMQ connection error", err);
    });
    connection.once("close", (cause?: Error) => {
      this.drop(connection, "RMQ connection closed unexpectedly", cause);
    });

    try {
      signal.throwIfAborted();

      const channel = await connection.createChannel();

      channel.on("error", (err: Error) => {
        this.logger.error("RMQ channel error", err);
      });
      channel.once("close", () => {
        // Deferred: when the whole connection drops, amqplib closes its
        // channels first; the connection `close` (with its cause) wins then.
        queueMicrotask(() => {
          this.drop(connection, "RMQ channel closed unexpectedly");
        });
      });

      const queue = await this.setupQueue(channel);

      signal.throwIfAborted();

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

      this.session = { connection, channel, consumerTag };
      this.logger.log(`RMQ server listening on queue "${queue}"`);
    } catch (err) {
      await closeQuietly(connection);
      throw err;
    }
  }

  /**
   * Handles the broker closing the connection or the consumer channel of the
   * running session: closes the connection and, unless `close()` started,
   * logs the drop and reconnects. Identity-checked, so the second event of one
   * drop, the events of a session still being set up (its setup fails
   * instead) and those of a session `close()` shuts down are ignored.
   */
  private drop(connection: ChannelModel, reason: string, cause?: Error): void {
    if (this.session?.connection !== connection) {
      return;
    }

    this.session = undefined;
    void closeQuietly(connection);

    if (!this.lifecycle) {
      return;
    }

    this.logger.error(`${reason}, reconnecting`, cause);
    this.connecting = this.reconnect(this.lifecycle.signal);
  }

  /**
   * Sets the server up again after a drop: one connection attempt at a time,
   * every `retryDelay` ms, until one consumes or `close()` aborts `signal`.
   * Logs every failed attempt; never rejects.
   */
  private async reconnect(signal: AbortSignal): Promise<void> {
    const retryDelay = this.options.retryDelay ?? 1000;
    const connectOptions: RmqOptions = {
      ...this.options,
      maxConnectionAttempts: 1,
    };

    for (;;) {
      try {
        await this.open(connectOptions, signal);
        return;
      } catch (err) {
        if (signal.aborted) {
          return;
        }

        this.logger.error(
          `RMQ reconnect failed, retrying in ${retryDelay} ms`,
          err,
        );
      }

      try {
        await delay(retryDelay, signal);
      } catch {
        return; // `close()` aborted the wait
      }
    }
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
