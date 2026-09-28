import type { CanActivate, CanActivateFn } from "@denorid/core";
import type {
  GenericFunction,
  InjectionToken,
  ModuleMetadata,
  Provider,
  Type,
} from "@denorid/injector";
import type { AmqpClientRegistration } from "./options.ts";
import type { AmqpSerializer } from "./serialization.ts";

/**
 * Static configuration for {@link AmqpModule.forRoot}.
 */
export interface AmqpModuleOptions {
  /** Broker URL. Default "amqp://localhost". */
  url?: string;
  /** Register the connection provider globally. */
  global?: boolean;
  /**
   * Guards run before every AMQP handler, ahead of class/method guards
   * (order: global -> controller -> method).
   */
  globalGuards?: (Type<CanActivate> | CanActivate | CanActivateFn)[];
  /**
   * The serializer shared by the consumers and every client.
   *
   * - `"json"` (default): {@link JsonAmqpSerializer}.
   * - `"msgpack"`: {@link MsgpackAmqpSerializer}.
   * - An {@link AmqpSerializer} instance is used directly.
   * - A `Type<AmqpSerializer>` class is resolved through DI and MUST also be
   *   registered in {@link extraProviders} so the container can build it (with
   *   its own injected dependencies).
   *
   * Both built-in serializers decode received bodies by their `contentType`,
   * so services publishing JSON and MessagePack can share queues; the choice
   * decides what is published.
   */
  serializer?: "json" | "msgpack" | AmqpSerializer | Type<AmqpSerializer>;
  /**
   * Additional providers registered alongside the connection and explorer.
   * Register a provider for the `AMQP_SERIALIZER` token here to override the
   * serializer with a DI-resolved (dependency-injected) implementation.
   */
  extraProviders?: Provider[];
  /**
   * Sender clients to register and export. Each entry is provided under its
   * `name` token (constructed from the shared {@link AmqpConnection}) and
   * automatically added to the module's exports.
   */
  clients?: AmqpClientRegistration[];
  /**
   * Delay in milliseconds before a consumer that could not be subscribed on
   * application bootstrap (broker unreachable, topology refused) or whose
   * channel closed unexpectedly (broker restart, lost connection, channel
   * error) is subscribed again. A failed attempt is retried after the same
   * delay until it succeeds or the application shuts down, so the application
   * starts while the broker is down.
   *
   * @default 1000
   */
  reconnectDelay?: number;
}

/**
 * Asynchronous configuration for {@link AmqpModule.forRootAsync}.
 */
export interface AmqpAsyncModuleOptions
  extends Pick<ModuleMetadata, "imports"> {
  /** Register the connection provider globally. */
  global?: boolean;
  /** Factory resolving the module options from injected dependencies. */
  useFactory: GenericFunction<
    | Omit<AmqpModuleOptions, "global">
    | Promise<Omit<AmqpModuleOptions, "global">>
  >;
  /** Tokens injected as arguments into {@link useFactory}. */
  inject?: InjectionToken[];
  /**
   * Additional providers registered alongside the connection and explorer.
   * Register a provider for the `AMQP_SERIALIZER` token here to override the
   * serializer with a DI-resolved (dependency-injected) implementation.
   */
  extraProviders?: Provider[];
  /**
   * Sender clients to register and export. Each entry is provided under its
   * `name` token (constructed from the shared {@link AmqpConnection}) and
   * automatically added to the module's exports.
   */
  clients?: AmqpClientRegistration[];
}
