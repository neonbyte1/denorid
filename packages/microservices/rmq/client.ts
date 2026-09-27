import type { Pattern } from "@denorid/core/microservices";
import { ClientProxy, serializePattern } from "@denorid/core/microservices";
import { Logger, type LoggerService } from "@denorid/logger";
import type { Channel, ChannelModel, ConsumeMessage, Options } from "amqplib";
import { Buffer } from "node:buffer";
import { closeQuietly, connectWithRetry } from "./_connection.ts";
import { RmqDeserializer } from "./deserializer.ts";
import type { RmqOptions } from "./options.ts";
import { RmqSerializer } from "./serializer.ts";

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** A fully set up connection: channel created, reply queue consumed. */
interface ClientSession {
  connection: ChannelModel;
  channel: Channel;
  replyQueue: string;
}

/**
 * Microservice client proxy using RabbitMQ via amqplib.
 *
 * Holds one connection with one channel and a reply queue, multiplexing
 * `send()` replies by `correlationId`. When the broker closes the channel or
 * connection, pending requests reject with `Connection closed` and the next
 * `send()`/`emit()` reconnects.
 */
export class RmqClient extends ClientProxy implements AsyncDisposable {
  private readonly logger: LoggerService = new Logger(RmqClient.name, {
    timestamp: true,
  });
  private session?: ClientSession;
  private connecting?: Promise<ClientSession>;
  /** Aborted (and replaced) by `close()` to cancel connects still in flight. */
  private lifecycle = new AbortController();
  /** Set while the channel reports backpressure; resolves on `drain`. */
  private drained?: Promise<void>;
  private readonly pending: Map<string, PendingEntry> = new Map();
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
    await this.open();
  }

  /**
   * @inheritdoc
   */
  public override async close(): Promise<void> {
    const closed = new Error("Connection closed");
    const { session, connecting } = this;

    this.lifecycle.abort(closed);
    this.lifecycle = new AbortController();
    this.session = undefined;
    this.connecting = undefined;
    this.rejectPending(closed);

    try {
      // A superseded connect closes what it opened, then rejects.
      await connecting;
      // deno-lint-ignore no-empty
    } catch {}

    await closeQuietly(session?.channel);
    await closeQuietly(session?.connection);
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

  /**
   * @inheritdoc
   */
  public override async send<T = unknown>(
    pattern: Pattern,
    data: unknown,
  ): Promise<T> {
    const body = Buffer.from(this.serializer.serialize({ data }));
    const session = await this.ensureConnected();
    const correlationId = crypto.randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<T>();

    this.pending.set(correlationId, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    try {
      this.publish(session, pattern, body, {
        correlationId,
        replyTo: session.replyQueue,
      });
    } catch (err) {
      this.pending.delete(correlationId);
      throw err;
    }

    return await promise;
  }

  /**
   * @inheritdoc
   */
  public override async emit(pattern: Pattern, data: unknown): Promise<void> {
    const body = Buffer.from(this.serializer.serialize({ data }));

    this.publish(await this.ensureConnected(), pattern, body, {});
  }

  /** Resolves with the current session, connecting (once) if there is none. */
  private open(): Promise<ClientSession> {
    if (this.session) {
      return Promise.resolve(this.session);
    }

    if (!this.connecting) {
      const connecting: Promise<ClientSession> = this.doConnect(
        this.lifecycle.signal,
      ).finally(() => {
        if (this.connecting === connecting) {
          this.connecting = undefined;
        }
      });
      this.connecting = connecting;
    }

    return this.connecting;
  }

  private async doConnect(signal: AbortSignal): Promise<ClientSession> {
    const connection = await connectWithRetry(this.options, signal);

    // amqplib rethrows `error` events nobody listens to, crashing the process.
    connection.on("error", (err: Error) => {
      this.logger.error("RMQ connection error", err);
    });
    connection.once("close", () => this.invalidate(connection));

    try {
      signal.throwIfAborted();
      const channel = await connection.createChannel();

      channel.on("error", (err: Error) => {
        this.logger.error("RMQ channel error", err);
      });
      channel.once("close", () => this.invalidate(connection));
      signal.throwIfAborted();

      const replyQueue = this.options.replyQueue ?? "";
      const { queue } = await channel.assertQueue(replyQueue, {
        exclusive: replyQueue === "",
        autoDelete: replyQueue === "",
      });
      signal.throwIfAborted();

      await channel.consume(
        queue,
        (msg) => {
          if (msg !== null) {
            this.handleReply(msg);
          }
        },
        { noAck: true },
      );
      signal.throwIfAborted();

      // Published only once complete: a concurrent send() never sees a
      // channel without its reply queue.
      this.session = { connection, channel, replyQueue: queue };

      return this.session;
    } catch (err) {
      await closeQuietly(connection);
      throw err;
    }
  }

  private async ensureConnected(): Promise<ClientSession> {
    const { signal } = this.lifecycle;

    await this.drained;
    // Do not reopen a connection `close()` ended while this call waited.
    signal.throwIfAborted();

    return await this.open();
  }

  /**
   * Publishes on `session`. Checked synchronously with the publish (and the
   * caller's pending entry): `close()` or a dropped channel may have ended the
   * session since it was handed out.
   */
  private publish(
    session: ClientSession,
    pattern: Pattern,
    body: Buffer,
    options: Options.Publish,
  ): void {
    if (session !== this.session) {
      throw new Error("Connection closed");
    }

    const { channel } = session;
    const msgOptions: Options.Publish = {
      ...options,
      headers: { ...this.options.headers, pattern: serializePattern(pattern) },
      persistent: this.options.persistent,
    };
    const published = this.options.exchange
      ? channel.publish(
        this.options.exchange,
        this.options.routingKey ?? "",
        body,
        msgOptions,
      )
      : channel.sendToQueue(
        this.options.queue ?? "denorid",
        body,
        msgOptions,
      );

    // `false` is backpressure, not failure: amqplib still delivers the frame.
    // Hold later publishes until the channel drains (or closes).
    if (!published && !this.drained) {
      const { promise, resolve } = Promise.withResolvers<void>();
      const release = (): void => {
        channel.off("drain", release);
        channel.off("close", release);
        this.drained = undefined;
        resolve();
      };

      channel.once("drain", release);
      channel.once("close", release);
      this.drained = promise;
    }
  }

  /**
   * Drops the session of `connection` after its channel or connection closed.
   * Identity-checked, so a late event of a replaced connection is ignored.
   */
  private invalidate(connection: ChannelModel): void {
    if (this.session?.connection !== connection) {
      return;
    }

    this.session = undefined;
    this.rejectPending(new Error("Connection closed"));
    // A channel-only close leaves the connection open. Deferred because when
    // the whole connection drops, amqplib emits the channel `close` while it
    // is still tearing the connection down.
    queueMicrotask(() => void closeQuietly(connection));
  }

  private rejectPending(err: Error): void {
    for (const entry of this.pending.values()) {
      entry.reject(err);
    }

    this.pending.clear();
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
