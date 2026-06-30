import type { OnBeforeApplicationShutdown } from "@denorid/injector";
import type { Channel, ConsumeMessage } from "amqplib";
import type { AmqpConnection } from "./connection.ts";
import type {
  ExchangeClientOptions,
  RpcClientOptions,
  WorkerClientOptions,
} from "./options.ts";

/**
 * Base class for all AMQP clients, owning the lazily-created {@link Channel}
 * and its teardown.
 *
 * Construct a concrete client directly with a shared {@link AmqpConnection}.
 * Manually-instantiated (non-DI) clients never receive the
 * {@link AbstractClient.onBeforeApplicationShutdown} hook, but their channel is
 * still torn down when the shared connection closes.
 *
 * @template T The client-specific options shape.
 */
export abstract class AbstractClient<T> implements OnBeforeApplicationShutdown {
  protected channel?: Channel;

  public constructor(
    protected readonly connection: AmqpConnection,
    protected readonly options: T,
  ) {}

  /**
   * Lazily creates and caches the channel, asserting the queue or exchange
   * this client targets.
   *
   * @return {Promise<Channel>} The cached channel.
   */
  protected abstract getChannel(): Promise<Channel>;

  /**
   * Closes the client channel, swallowing any close error.
   *
   * @return {Promise<void>}
   */
  public async close(): Promise<void> {
    try {
      await this.channel?.close();
      // deno-lint-ignore no-empty
    } catch {}

    this.channel = undefined;
  }

  /**
   * @inheritdoc
   */
  public onBeforeApplicationShutdown(): Promise<void> {
    return this.close();
  }
}

/**
 * Sends messages to a work queue (default exchange, round-robin delivery).
 *
 * @see {@link AbstractClient} for connection and shutdown semantics.
 */
export class WorkerClient extends AbstractClient<WorkerClientOptions> {
  /**
   * Publishes a message to the work queue.
   *
   * @param {unknown} data - The payload to send.
   * @return {Promise<void>}
   */
  public async send(data: unknown): Promise<void> {
    const channel = await this.getChannel();

    channel.sendToQueue(
      this.options.queue,
      this.connection.serializer.serialize(data),
      {
        persistent: this.options.persistent ?? true,
      },
    );
  }

  protected async getChannel(): Promise<Channel> {
    if (!this.channel) {
      this.channel = await this.connection.createChannel();

      await this.channel.assertQueue(this.options.queue, {
        durable: this.options.durable ?? true,
      });
    }

    return this.channel;
  }
}

/**
 * Publishes messages to a fanout exchange (broadcast to all bound queues).
 *
 * @see {@link AbstractClient} for connection and shutdown semantics.
 */
export class PublisherClient extends AbstractClient<ExchangeClientOptions> {
  /**
   * Broadcasts a message to the fanout exchange.
   *
   * @param {unknown} data - The payload to publish.
   * @return {Promise<void>}
   */
  public async publish(data: unknown): Promise<void> {
    const channel = await this.getChannel();

    channel.publish(
      this.options.exchange,
      "",
      this.connection.serializer.serialize(data),
    );
  }

  protected async getChannel(): Promise<Channel> {
    if (!this.channel) {
      this.channel = await this.connection.createChannel();

      await this.channel.assertExchange(this.options.exchange, "fanout", {
        durable: this.options.durable ?? true,
      });
    }

    return this.channel;
  }
}

/**
 * Publishes messages to a direct exchange, routed by an exact routing key.
 *
 * @see {@link AbstractClient} for connection and shutdown semantics.
 */
export class RoutingClient extends AbstractClient<ExchangeClientOptions> {
  /**
   * Publishes a message to the direct exchange under the given routing key.
   *
   * @param {string} routingKey - The exact routing key.
   * @param {unknown} data - The payload to publish.
   * @return {Promise<void>}
   */
  public async publish(routingKey: string, data: unknown): Promise<void> {
    const channel = await this.getChannel();

    channel.publish(
      this.options.exchange,
      routingKey,
      this.connection.serializer.serialize(data),
    );
  }

  protected async getChannel(): Promise<Channel> {
    if (!this.channel) {
      this.channel = await this.connection.createChannel();

      await this.channel.assertExchange(this.options.exchange, "direct", {
        durable: this.options.durable ?? true,
      });
    }

    return this.channel;
  }
}

/**
 * Publishes messages to a topic exchange, routed by a pattern key.
 *
 * @see {@link AbstractClient} for connection and shutdown semantics.
 */
export class TopicClient extends AbstractClient<ExchangeClientOptions> {
  /**
   * Publishes a message to the topic exchange under the given routing key.
   *
   * @param {string} routingKey - The routing key (may contain `*` / `#`).
   * @param {unknown} data - The payload to publish.
   * @return {Promise<void>}
   */
  public async publish(routingKey: string, data: unknown): Promise<void> {
    const channel = await this.getChannel();

    channel.publish(
      this.options.exchange,
      routingKey,
      this.connection.serializer.serialize(data),
    );
  }

  protected async getChannel(): Promise<Channel> {
    if (!this.channel) {
      this.channel = await this.connection.createChannel();

      await this.channel.assertExchange(this.options.exchange, "topic", {
        durable: this.options.durable ?? true,
      });
    }

    return this.channel;
  }
}

interface RpcPendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer?: NodeJS.Timeout;
}

/**
 * Issues request/reply (RPC) calls against a request queue.
 *
 * Each request mints a `correlationId`, registers a pending promise, and
 * publishes to the request queue with a dedicated exclusive reply queue as
 * `replyTo`. Replies are correlated back by `correlationId`.
 *
 * @see {@link AbstractClient} for connection and shutdown semantics.
 */
export class RpcClient extends AbstractClient<RpcClientOptions> {
  private replyQueue?: string;
  private readonly pending: Map<string, RpcPendingEntry> = new Map();

  /**
   * Sends a request and resolves with the correlated reply.
   *
   * @template T The expected reply type.
   * @param {unknown} data - The request payload.
   * @return {Promise<T>} The reply payload.
   */
  public async request<T = unknown>(data: unknown): Promise<T> {
    const channel = await this.getChannel();
    const correlationId = crypto.randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const entry: RpcPendingEntry = {
      resolve: resolve as (value: unknown) => void,
      reject,
    };

    if (this.options.timeout != null) {
      entry.timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new Error("RPC request timed out"));
      }, this.options.timeout);
    }

    this.pending.set(correlationId, entry);

    channel.sendToQueue(
      this.options.queue,
      this.connection.serializer.serialize(data),
      {
        correlationId,
        replyTo: this.replyQueue,
      },
    );

    return promise;
  }

  /**
   * Rejects all in-flight requests, clears their timers, and closes the
   * channel. Idempotent: a second call with no channel is a no-op.
   *
   * @return {Promise<void>}
   */
  public override async close(): Promise<void> {
    const err = new Error("Connection closed");

    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }

    this.pending.clear();

    try {
      await this.channel?.close();
      // deno-lint-ignore no-empty
    } catch {}

    this.channel = undefined;
    this.replyQueue = undefined;
  }

  protected async getChannel(): Promise<Channel> {
    if (!this.channel) {
      this.channel = await this.connection.createChannel();

      const reply = await this.channel.assertQueue("", {
        exclusive: true,
        autoDelete: true,
      });

      this.replyQueue = reply.queue;

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

    return this.channel;
  }

  private handleReply(msg: ConsumeMessage): void {
    const correlationId: string | undefined = msg.properties.correlationId;

    if (!correlationId) {
      return;
    }

    const entry = this.pending.get(correlationId);

    if (!entry) {
      return;
    }

    this.pending.delete(correlationId);
    clearTimeout(entry.timer);

    const parsed = this.connection.serializer.deserialize(msg.content);

    if (parsed !== null && typeof parsed === "object" && "err" in parsed) {
      entry.reject(new Error(String(parsed.err)));
    } else {
      entry.resolve(parsed);
    }
  }
}
