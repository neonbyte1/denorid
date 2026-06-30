import {
  Inject,
  Injectable,
  type OnBeforeApplicationShutdown,
} from "@denorid/injector";
import amqplib, { type Channel, type ChannelModel } from "amqplib";
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
 * in-flight `amqplib.connect`. Closing the underlying `ChannelModel` cascades,
 * tearing down every channel created from it.
 */
@Injectable()
export class AmqpConnection implements OnBeforeApplicationShutdown {
  @Inject(AMQP_MODULE_OPTIONS)
  private readonly options!: AmqpModuleOptions;

  @Inject(AMQP_SERIALIZER)
  private readonly _serializer?: AmqpSerializer;

  private model?: ChannelModel;
  private connecting?: Promise<ChannelModel>;

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
   * Returns the shared broker connection, establishing it on first use.
   *
   * @return {Promise<ChannelModel>} The live channel model.
   */
  public async connect(): Promise<ChannelModel> {
    if (this.model) {
      return this.model;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = amqplib.connect(this.options.url ?? DEFAULT_AMQP_URL);

    try {
      this.model = await this.connecting;

      return this.model;
    } finally {
      this.connecting = undefined;
    }
  }

  /**
   * Opens a new channel on the shared connection.
   *
   * @return {Promise<Channel>} The created channel.
   */
  public async createChannel(): Promise<Channel> {
    const model = await this.connect();

    return model.createChannel();
  }

  /**
   * Closes the shared connection, swallowing any close error. Idempotent: a
   * second call with no live connection is a no-op.
   *
   * @return {Promise<void>}
   */
  public async close(): Promise<void> {
    try {
      await this.model?.close();
      // deno-lint-ignore no-empty
    } catch {}

    this.model = undefined;
    this.connecting = undefined;
  }

  /**
   * @inheritdoc
   */
  public onBeforeApplicationShutdown(): Promise<void> {
    return this.close();
  }
}
