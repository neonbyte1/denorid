import { Inject, Injectable } from "@denorid/injector";
import { Logger } from "@denorid/logger";
import amqplib, {
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
} from "amqplib";
import {
  AMQP_MODULE_OPTIONS,
  AMQP_SERIALIZER,
  DEFAULT_AMQP_URL,
} from "./_constants.ts";
import type { AmqpModuleOptions } from "./module_options.ts";
import { type AmqpSerializer, JsonAmqpSerializer } from "./serialization.ts";

/** Fallback serializer for connections constructed outside the DI container. */
const DEFAULT_SERIALIZER: AmqpSerializer = new JsonAmqpSerializer();

/**
 * The single shared broker connection every client and the explorer pulls
 * channels from.
 *
 * Connecting is lazy and idempotent: concurrent {@link connect} calls share one
 * in-flight `amqplib.connect`. Connection and channel `error` events are
 * logged instead of crashing the process, and a connection that closes (for
 * example because the broker went away) is dropped, so the next
 * {@link connect} or {@link createChannel} opens a fresh one. Closing the
 * underlying `ChannelModel` cascades, tearing down every channel created from
 * it.
 *
 * Under DI the connection is closed when the container disposes it, after
 * every shutdown hook ran, so other providers can still publish from their own
 * hooks.
 */
@Injectable()
export class AmqpConnection implements AsyncDisposable {
  private readonly logger = new Logger(AmqpConnection.name, {
    timestamp: true,
  });

  /** Unset when the connection is constructed outside the DI container. */
  @Inject(AMQP_MODULE_OPTIONS)
  private readonly options?: AmqpModuleOptions;

  @Inject(AMQP_SERIALIZER)
  private readonly _serializer?: AmqpSerializer;

  private model?: ChannelModel;
  private connecting?: Promise<ChannelModel>;

  /** Bumped by {@link close} so a connect still in flight knows it is stale. */
  private generation = 0;

  /**
   * The serializer shared by every client and the explorer. Resolves to the
   * configured serializer under DI, or the default JSON serializer when the
   * connection is constructed manually.
   *
   * @return {AmqpSerializer} The active serializer.
   */
  public get serializer(): AmqpSerializer {
    return this._serializer ?? DEFAULT_SERIALIZER;
  }

  /**
   * Returns the shared broker connection, establishing it on first use and
   * again after the previous connection closed.
   *
   * @return {Promise<ChannelModel>} The live channel model.
   * @throws {Error} When connecting fails, or when {@link close} is called
   *   before the connection was established.
   */
  public connect(): Promise<ChannelModel> {
    if (this.model) {
      return Promise.resolve(this.model);
    }

    this.connecting ??= this.open();

    return this.connecting;
  }

  /**
   * Opens a new channel on the shared connection. Channel `error` events are
   * logged; callers that cache the channel should drop it on its `close`
   * event.
   *
   * @return {Promise<Channel>} The created channel.
   */
  public async createChannel(): Promise<Channel> {
    const model = await this.connect();

    return this.watch(await model.createChannel());
  }

  /**
   * Opens a channel in confirm mode on the shared connection: the broker
   * acknowledges every message published on it once it took responsibility
   * for it. Channel `error` events are logged; callers that cache the channel
   * should drop it on its `close` event.
   *
   * @return {Promise<ConfirmChannel>} The created confirm channel.
   */
  public async createConfirmChannel(): Promise<ConfirmChannel> {
    const model = await this.connect();

    return this.watch(await model.createConfirmChannel());
  }

  /**
   * Closes the shared connection, swallowing any close error. A connect still
   * in flight is closed as soon as it completes (its callers reject), so no
   * connection outlives this call. Idempotent: a second call with no live
   * connection is a no-op.
   *
   * @return {Promise<void>}
   */
  public async close(): Promise<void> {
    const model = this.model;
    const connecting = this.connecting;

    this.generation++;
    this.model = undefined;
    this.connecting = undefined;

    try {
      await model?.close();
      // deno-lint-ignore no-empty
    } catch {}

    // The stale connect closes whatever it opened before rejecting.
    await connecting?.catch(() => {});
  }

  /**
   * Closes the connection when the DI container (or an `await using` block)
   * disposes it.
   *
   * @return {Promise<void>}
   */
  public [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private watch<C extends Channel>(channel: C): C {
    channel.on("error", (err: Error) => {
      this.logger.error("AMQP channel error", err);
    });

    return channel;
  }

  private async open(): Promise<ChannelModel> {
    const generation = this.generation;

    try {
      const model = await amqplib.connect(
        this.options?.url ?? DEFAULT_AMQP_URL,
      );

      model.on("error", (err: Error) => {
        this.logger.error("AMQP connection error", err);
      });

      if (generation !== this.generation) {
        try {
          await model.close();
          // deno-lint-ignore no-empty
        } catch {}

        throw new Error("AMQP connection closed while connecting");
      }

      model.once("close", () => {
        if (this.model === model) {
          this.model = undefined;
        }
      });

      this.model = model;

      return model;
    } finally {
      if (generation === this.generation) {
        this.connecting = undefined;
      }
    }
  }
}
