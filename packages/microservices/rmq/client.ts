import type { Pattern } from "@denorid/core/microservices";
import { ClientProxy, serializePattern } from "@denorid/core/microservices";
import type { OnBeforeApplicationShutdown } from "@denorid/injector/hooks";
import amqplib, {
  type Channel,
  type ChannelModel,
  type ConsumeMessage,
} from "amqplib";
import { Buffer } from "node:buffer";
import { RmqDeserializer } from "./deserializer.ts";
import type { RmqOptions } from "./options.ts";
import { RmqSerializer } from "./serializer.ts";

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Microservice client proxy using RabbitMQ via amqplib.
 */
export class RmqClient extends ClientProxy
  implements OnBeforeApplicationShutdown {
  private connection?: ChannelModel;
  private channel?: Channel;
  private replyQueue?: string;
  private readonly pending: Map<string, PendingEntry> = new Map();
  private connecting?: Promise<void>;
  private readonly serializer = new RmqSerializer();
  private readonly deserializer = new RmqDeserializer();

  /**
   * @param {RmqOptions} options - RabbitMQ client configuration.
   */
  public constructor(private readonly options: RmqOptions) {
    super();
  }

  /**
   * @inheritdoc
   */
  public override async connect(): Promise<void> {
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.doConnect();

    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  /**
   * @inheritdoc
   */
  public override async close(): Promise<void> {
    const err = new Error("Connection closed");

    for (const entry of this.pending.values()) {
      entry.reject(err);
    }

    this.pending.clear();

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
    this.replyQueue = undefined;
  }

  /**
   * @inheritdoc
   */
  public async onBeforeApplicationShutdown(): Promise<void> {
    await this.close();
  }

  /**
   * @inheritdoc
   */
  public override async send<T = unknown>(
    pattern: Pattern,
    data: unknown,
  ): Promise<T> {
    await this.ensureConnected();

    const correlationId = crypto.randomUUID();
    const queue = this.options.queue ?? "denorid";
    const serialized = serializePattern(pattern);

    return new Promise<T>((resolve, reject) => {
      this.pending.set(correlationId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      const msgOptions = {
        correlationId,
        replyTo: this.replyQueue,
        headers: { pattern: serialized },
        persistent: this.options.persistent,
      };
      const body = Buffer.from(this.serializer.serialize({ data }));
      const published = this.options.exchange
        ? this.channel!.publish(
          this.options.exchange,
          this.options.routingKey ?? "",
          body,
          msgOptions,
        )
        : this.channel!.sendToQueue(queue, body, msgOptions);

      if (!published) {
        this.pending.delete(correlationId);
        reject(new Error("Failed to publish message - channel buffer full"));
      }
    });
  }

  /**
   * @inheritdoc
   */
  public override async emit(pattern: Pattern, data: unknown): Promise<void> {
    await this.ensureConnected();

    const queue = this.options.queue ?? "denorid";
    const msgOptions = {
      headers: { pattern: serializePattern(pattern) },
      persistent: this.options.persistent,
    };
    const body = Buffer.from(this.serializer.serialize({ data }));

    if (this.options.exchange) {
      this.channel!.publish(
        this.options.exchange,
        this.options.routingKey ?? "",
        body,
        msgOptions,
      );
    } else {
      this.channel!.sendToQueue(queue, body, msgOptions);
    }
  }

  private async doConnect(): Promise<void> {
    const url = this.options.url ?? "amqp://localhost";

    this.connection = await amqplib.connect(url as string);
    this.channel = await this.connection.createChannel();

    const replyQueue = this.options.replyQueue ?? "";
    const queueResponse = await this.channel.assertQueue(replyQueue, {
      exclusive: replyQueue === "",
      autoDelete: replyQueue === "",
    });

    this.replyQueue = queueResponse.queue;

    await this.channel.consume(
      this.replyQueue,
      (msg) => {
        if (msg !== null) {
          this.handleReply(msg);
        }
      },
      { noAck: true },
    );
  }

  private async ensureConnected(): Promise<void> {
    if (!this.channel) {
      await this.connect();
    }
  }

  private handleReply(msg: ConsumeMessage): void {
    const { correlationId } = msg.properties;

    if (!correlationId) {
      return;
    }

    const entry = this.pending.get(correlationId as string);

    if (!entry) {
      return;
    }

    this.pending.delete(correlationId as string);

    let parsed: unknown;
    const contentType = msg.properties.contentType as string | undefined;

    if (contentType === "application/octet-stream") {
      parsed = new Uint8Array(msg.content);
    } else {
      try {
        parsed = this.deserializer.deserialize(msg.content);
      } catch {
        entry.reject(new Error("Failed to parse reply message"));
        return;
      }
    }

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "err" in parsed
    ) {
      entry.reject(new Error(String((parsed as { err: unknown }).err)));
    } else {
      entry.resolve(parsed);
    }
  }
}
