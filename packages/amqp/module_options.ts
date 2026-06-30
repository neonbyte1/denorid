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
   * Overrides the default JSON serializer.
   *
   * Pass an {@link AmqpSerializer} instance to use it directly, or a
   * `Type<AmqpSerializer>` class to have it resolved through DI - a class MUST
   * also be registered in {@link extraProviders} so the container can build it
   * (with its own injected dependencies).
   */
  serializer?: AmqpSerializer | Type<AmqpSerializer>;
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
