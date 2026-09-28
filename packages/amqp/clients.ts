import type { Channel, ConfirmChannel, ConsumeMessage } from "amqplib";
import type { Buffer } from "node:buffer";
import { queueDeclaration } from "./_queue.ts";
import type { AmqpConnection } from "./connection.ts";
import type {
  ExchangeClientOptions,
  PublishOptions,
  RpcClientOptions,
  WorkerClientOptions,
} from "./options.ts";

/** A serialized message body plus the `contentType` describing it. */
interface EncodedMessage {
  content: Buffer;
  contentType?: string;
}

/**
 * Base class for all AMQP clients, owning the lazily-created
 * {@link ConfirmChannel} and its teardown.
 *
 * The channel is opened in confirm mode and set up (see {@link setupChannel})
 * once, shared by concurrent first calls, and dropped when it closes (broker
 * drop, channel error), so the next call opens a fresh one. Messages sent
 * through {@link publishConfirmed} resolve only once the broker confirmed
 * them.
 *
 * Construct a concrete client directly with a shared {@link AmqpConnection}.
 * Clients registered through `AmqpModuleOptions.clients` are closed when the
 * DI container disposes them; manually-instantiated clients should be closed
 * (or declared with `await using`), but their channel is still torn down when
 * the shared connection closes.
 *
 * @template T The client-specific options shape.
 */
export abstract class AbstractClient<T> implements AsyncDisposable {
  private channelReady?: Promise<ConfirmChannel>;

  public constructor(
    protected readonly connection: AmqpConnection,
    protected readonly options: T,
  ) {}

  /**
   * Asserts the queue or exchange this client targets on a freshly created
   * channel. Runs once per channel, before any caller receives it.
   *
   * @param {ConfirmChannel} channel - The channel to set up.
   * @return {Promise<void>}
   */
  protected abstract setupChannel(channel: ConfirmChannel): Promise<void>;

  /**
   * Called once a channel handed out by {@link getChannel} closed, for
   * whatever reason. The channel is already dropped from the cache.
   *
   * @param {Channel} _channel - The closed channel.
   */
  protected onChannelClosed(_channel: Channel): void {}

  /**
   * Returns the cached channel, creating and setting it up on first use and
   * again after the previous channel closed.
   *
   * @return {Promise<ConfirmChannel>} The ready channel.
   */
  protected getChannel(): Promise<ConfirmChannel> {
    if (this.channelReady) {
      return this.channelReady;
    }

    const { promise, resolve, reject } = Promise.withResolvers<
      ConfirmChannel
    >();

    this.channelReady = promise;
    this.openChannel(promise).then(resolve, reject);

    return promise;
  }

  /**
   * Serializes a payload with the connection's serializer.
   *
   * @param {unknown} data - The payload.
   * @return {EncodedMessage} The message body and its content type.
   */
  protected encode(data: unknown): EncodedMessage {
    const { serializer } = this.connection;

    return {
      content: serializer.serialize(data),
      contentType: serializer.contentType?.(data),
    };
  }

  /**
   * Serializes and publishes a message, resolving once the broker confirmed
   * it. From then on the broker is responsible for the message: a persistent
   * message routed to a durable queue survives a broker restart.
   *
   * @param {string} exchange - The target exchange (`""` is the default
   *   exchange, routing by queue name).
   * @param {string} routingKey - The routing key.
   * @param {unknown} data - The payload.
   * @param {boolean} persistent - Persistence used when the message options
   *   do not set it.
   * @param {PublishOptions} [options] - Per-message properties.
   * @return {Promise<void>}
   * @throws {Error} When the broker rejects the message or the channel closes
   *   before the broker confirmed it.
   */
  protected async publishConfirmed(
    exchange: string,
    routingKey: string,
    data: unknown,
    persistent: boolean,
    options: PublishOptions = {},
  ): Promise<void> {
    const { content, contentType } = this.encode(data);
    const channel = await this.getChannel();
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    channel.publish(
      exchange,
      routingKey,
      content,
      { ...options, persistent: options.persistent ?? persistent, contentType },
      (err: unknown): void => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      },
    );

    return promise;
  }

  /**
   * Closes the client channel (waiting for one still being opened), once the
   * broker confirmed or refused every message still in flight on it, and
   * swallows any close error. Idempotent: a second call with no channel is a
   * no-op; a later call reopens a channel.
   *
   * @return {Promise<void>}
   */
  public async close(): Promise<void> {
    const ready = this.channelReady;

    this.channelReady = undefined;

    const channel = await ready?.catch(() => undefined);

    // Closing first would fail publishes the broker already accepted: amqplib
    // drops confirms that arrive while the channel is closing.
    await channel?.waitForConfirms().catch(() => {});

    try {
      await channel?.close();
      // deno-lint-ignore no-empty
    } catch {}
  }

  /**
   * Closes the client when the DI container (or an `await using` block)
   * disposes it.
   *
   * @return {Promise<void>}
   */
  public [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private async openChannel(
    ready: Promise<ConfirmChannel>,
  ): Promise<ConfirmChannel> {
    try {
      const channel = await this.connection.createConfirmChannel();

      channel.once("close", () => {
        if (this.channelReady === ready) {
          this.channelReady = undefined;
        }

        this.onChannelClosed(channel);
      });

      try {
        await this.setupChannel(channel);
      } catch (err) {
        try {
          await channel.close();
          // deno-lint-ignore no-empty
        } catch {}

        throw err;
      }

      return channel;
    } catch (err) {
      if (this.channelReady === ready) {
        this.channelReady = undefined;
      }

      throw err;
    }
  }
}

/**
 * Sends messages to a work queue (default exchange, round-robin delivery).
 *
 * @see {@link AbstractClient} for connection and shutdown semantics.
 */
export class WorkerClient extends AbstractClient<WorkerClientOptions> {
  /**
   * Publishes a message to the work queue. Resolves once the broker
   * confirmed it.
   *
   * @param {unknown} data - The payload to send.
   * @param {PublishOptions} [options] - Per-message properties.
   * @return {Promise<void>}
   */
  public send(data: unknown, options?: PublishOptions): Promise<void> {
    return this.publishConfirmed(
      "",
      this.options.queue,
      data,
      this.options.persistent ?? true,
      options,
    );
  }

  protected async setupChannel(channel: Channel): Promise<void> {
    await channel.assertQueue(
      this.options.queue,
      queueDeclaration(this.options.queue, this.options, {
        durable: this.options.durable ?? true,
      }),
    );
  }
}

/**
 * Publishes messages to a fanout exchange (broadcast to all bound queues).
 *
 * @see {@link AbstractClient} for connection and shutdown semantics.
 */
export class PublisherClient extends AbstractClient<ExchangeClientOptions> {
  /**
   * Broadcasts a message to the fanout exchange. Resolves once the broker
   * confirmed it.
   *
   * @param {unknown} data - The payload to publish.
   * @param {PublishOptions} [options] - Per-message properties.
   * @return {Promise<void>}
   */
  public publish(data: unknown, options?: PublishOptions): Promise<void> {
    return this.publishConfirmed(
      this.options.exchange,
      "",
      data,
      this.options.persistent ?? true,
      options,
    );
  }

  protected async setupChannel(channel: Channel): Promise<void> {
    await channel.assertExchange(this.options.exchange, "fanout", {
      durable: this.options.durable ?? true,
    });
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
   * Resolves once the broker confirmed it.
   *
   * @param {string} routingKey - The exact routing key.
   * @param {unknown} data - The payload to publish.
   * @param {PublishOptions} [options] - Per-message properties.
   * @return {Promise<void>}
   */
  public publish(
    routingKey: string,
    data: unknown,
    options?: PublishOptions,
  ): Promise<void> {
    return this.publishConfirmed(
      this.options.exchange,
      routingKey,
      data,
      this.options.persistent ?? true,
      options,
    );
  }

  protected async setupChannel(channel: Channel): Promise<void> {
    await channel.assertExchange(this.options.exchange, "direct", {
      durable: this.options.durable ?? true,
    });
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
   * Resolves once the broker confirmed it.
   *
   * @param {string} routingKey - The routing key, e.g. `post.created`.
   * @param {unknown} data - The payload to publish.
   * @param {PublishOptions} [options] - Per-message properties.
   * @return {Promise<void>}
   */
  public publish(
    routingKey: string,
    data: unknown,
    options?: PublishOptions,
  ): Promise<void> {
    return this.publishConfirmed(
      this.options.exchange,
      routingKey,
      data,
      this.options.persistent ?? true,
      options,
    );
  }

  protected async setupChannel(channel: Channel): Promise<void> {
    await channel.assertExchange(this.options.exchange, "topic", {
      durable: this.options.durable ?? true,
    });
  }
}

interface RpcPendingEntry {
  /** The channel the request was sent on (its reply queue receives the reply). */
  channel: Channel;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer?: NodeJS.Timeout;
}

/**
 * Issues request/reply (RPC) calls against a request queue.
 *
 * Each request mints a `correlationId`, registers a pending promise, and
 * publishes to the request queue with the channel's dedicated exclusive reply
 * queue as `replyTo`. Replies are correlated back by `correlationId`. When the
 * channel closes, its reply queue is gone, so every request still waiting on
 * it is rejected.
 *
 * @see {@link AbstractClient} for connection and shutdown semantics.
 */
export class RpcClient extends AbstractClient<RpcClientOptions> {
  private readonly replyQueues: WeakMap<Channel, string> = new WeakMap();
  private readonly pending: Map<string, RpcPendingEntry> = new Map();

  /**
   * Sends a request and resolves with the correlated reply.
   *
   * @template T The expected reply type.
   * @param {unknown} data - The request payload.
   * @return {Promise<T>} The reply payload.
   */
  public async request<T = unknown>(data: unknown): Promise<T> {
    const { content, contentType } = this.encode(data);
    const channel = await this.getChannel();
    const correlationId = crypto.randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const entry: RpcPendingEntry = {
      channel,
      resolve: resolve as (value: unknown) => void,
      reject,
    };

    this.pending.set(correlationId, entry);

    try {
      channel.sendToQueue(this.options.queue, content, {
        correlationId,
        replyTo: this.replyQueues.get(channel),
        contentType,
      });
    } catch (err) {
      this.pending.delete(correlationId);

      throw err;
    }

    if (this.options.timeout != null) {
      entry.timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new Error("RPC request timed out"));
      }, this.options.timeout);
    }

    return promise;
  }

  /**
   * Rejects all in-flight requests, clears their timers, and closes the
   * channel. Idempotent: a second call with no channel is a no-op.
   *
   * @return {Promise<void>}
   */
  public override async close(): Promise<void> {
    this.rejectPending(new Error("Connection closed"));

    await super.close();
  }

  protected async setupChannel(channel: Channel): Promise<void> {
    const reply = await channel.assertQueue("", {
      exclusive: true,
      autoDelete: true,
    });

    await channel.consume(
      reply.queue,
      (msg) => {
        if (msg !== null) {
          this.handleReply(msg);

          return;
        }

        // The broker cancelled the reply consumer (e.g. the queue was
        // deleted): no reply can arrive anymore. Closing the channel rejects
        // the requests waiting on it; the next request opens a new one.
        channel.close().catch(() => {});
      },
      { noAck: true },
    );

    this.replyQueues.set(channel, reply.queue);
  }

  protected override onChannelClosed(channel: Channel): void {
    this.rejectPending(new Error("RPC channel closed"), channel);
  }

  private rejectPending(err: Error, channel?: Channel): void {
    for (const [correlationId, entry] of this.pending) {
      if (channel === undefined || entry.channel === channel) {
        this.pending.delete(correlationId);
        clearTimeout(entry.timer);
        entry.reject(err);
      }
    }
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

    let parsed: unknown;

    try {
      parsed = this.connection.serializer.deserialize(
        msg.content,
        msg.properties,
      );
    } catch (err) {
      entry.reject(new Error("Failed to parse reply message", { cause: err }));

      return;
    }

    if (parsed !== null && typeof parsed === "object" && "err" in parsed) {
      entry.reject(new Error(String(parsed.err)));
    } else {
      entry.resolve(parsed);
    }
  }
}
