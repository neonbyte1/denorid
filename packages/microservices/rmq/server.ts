import amqplib, {
  type Channel,
  type ChannelModel,
  type ConsumeMessage,
} from "amqplib";
import { Buffer } from "node:buffer";
import { Server } from "../server.ts";
import { RmqDeserializer } from "./deserializer.ts";
import type { RmqOptions } from "./options.ts";
import { RmqSerializer } from "./serializer.ts";

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
  private closing = false;
  private readonly serializer = new RmqSerializer();
  private readonly deserializer = new RmqDeserializer();

  /**
   * @inheritdoc
   */
  public override async listen(): Promise<void> {
    const url = this.options.url ?? "amqp://localhost";

    this.connection = await amqplib.connect(url as string);
    this.channel = await this.connection.createChannel();

    const queue = this.options.queue ?? "denorid";
    let actualQueue = queue;

    if (!this.options.noAssert) {
      const queueResponse = await this.channel.assertQueue(queue, {
        durable: this.options.queueOptions?.durable ?? true,
        ...this.options.queueOptions,
      });
      actualQueue = queueResponse.queue;
    }

    if (this.options.prefetchCount != null) {
      await this.channel.prefetch(
        this.options.prefetchCount,
        this.options.isGlobalPrefetchCount,
      );
    }

    if (this.options.exchange) {
      if (!this.options.noAssert) {
        await this.channel.assertExchange(
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

      await this.channel.bindQueue(
        actualQueue,
        this.options.exchange,
        this.options.routingKey ?? "",
      );
    }

    await this.channel.consume(
      actualQueue,
      (msg) => {
        if (msg !== null) {
          this.handleMessage(msg).catch((err) => {
            this.logger.error("Unhandled error in RMQ message handler", err);
          });
        }
      },
      {
        noAck: this.options.noAck ?? false,
        consumerTag: this.options.consumerTag,
      },
    );

    this.logger.log(`RMQ server listening on queue "${actualQueue}"`);

    await new Promise<void>((resolve, reject) => {
      this.connection!.on("error", reject);
      this.connection!.on("close", () => {
        if (this.closing) resolve();
        else reject(new Error("RMQ connection closed unexpectedly"));
      });
    });
  }

  /**
   * @inheritdoc
   */
  public override async close(): Promise<void> {
    this.closing = true;

    try {
      await this.channel?.close();
      // deno-lint-ignore no-empty
    } catch {}

    try {
      await this.connection?.close();
      // deno-lint-ignore no-empty
    } catch {}

    this.channel = undefined;
    this.connection = undefined;
    this.closing = false;
  }

  private async handleMessage(msg: ConsumeMessage): Promise<void> {
    const headers = msg.properties.headers as Record<string, unknown>;
    const pattern = String(headers?.["pattern"] ?? "");
    const body = this.deserializer.deserialize(msg.content) as {
      data: unknown;
    };
    const { correlationId, replyTo } = msg.properties;
    const isRequestResponse = Boolean(correlationId && replyTo);

    try {
      const response = await this.dispatch(pattern, body.data);

      if (isRequestResponse) {
        const payload = Buffer.from(this.serializer.serialize(response));
        const contentType = this.serializer.contentTypeFor(response);
        this.channel!.sendToQueue(replyTo as string, payload, {
          correlationId: correlationId as string,
          contentType,
        });
      }

      if (!this.options.noAck) {
        this.channel!.ack(msg);
      }
    } catch (err) {
      if (isRequestResponse) {
        this.channel!.sendToQueue(
          replyTo as string,
          Buffer.from(
            JSON.stringify({
              err: err instanceof Error ? err.message : String(err),
            }),
          ),
          { correlationId: correlationId as string },
        );
      }

      if (!this.options.noAck) {
        this.channel!.nack(msg, false, false);
      }
    }
  }
}
