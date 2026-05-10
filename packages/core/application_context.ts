import type {
  InjectionToken,
  ModuleRefContextOptions,
  ModuleRefOptions,
  Tag,
} from "@denorid/injector";
import type { CanActivate, CanActivateFn } from "./guards/can_activate.ts";
import type { MicroserviceServer } from "./microservices/server.ts";

/**
 * Interface defining the core application context.
 */
export interface ApplicationContext extends AsyncDisposable {
  /**
   * Resolves a registered provider by its injection token.
   *
   * @param {InjectionToken<T>} token - The injection token to look up.
   * @param {ModuleRefOptions} [options] - Optional resolution options.
   * @returns {Promise<T>} The resolved provider instance.
   *
   * @throws {TokenNotFoundError} When no provider is registered for the given token.
   */
  get<T>(token: InjectionToken<T>, options?: ModuleRefOptions): Promise<T>;
  /**
   * Resolves a registered provider by its injection token within a specific context.
   *
   * @param {InjectionToken<T>} token - The injection token to look up.
   * @param {ModuleRefContextOptions} options - Context-scoped resolution options.
   * @returns {Promise<T>} The resolved provider instance.
   *
   * @throws {TokenNotFoundError} When no provider is registered for the given token.
   */
  get<T>(
    token: InjectionToken<T>,
    options: ModuleRefContextOptions,
  ): Promise<T>;

  /**
   * Resolves all providers registered with a given tag.
   *
   * @param {Tag} tag - Tag to filter providers by.
   * @param {ModuleRefOptions} [options] - Optional resolution options.
   * @returns {Promise<T[]>} Array of resolved provider instances matching the tag.
   */
  getByTag<T = unknown>(
    tag: Tag,
    options?: ModuleRefOptions,
  ): Promise<T[]>;
  /**
   * Resolves all providers registered with the given tags within a specific context.
   *
   * @param {Tag[]} tags - Tags to filter providers by.
   * @param {ModuleRefContextOptions} options - Context-scoped resolution options.
   * @returns {Promise<T[]>} Array of resolved provider instances matching the tags.
   */
  getByTag<T = unknown>(
    tags: Tag[],
    options: ModuleRefContextOptions,
  ): Promise<T[]>;

  /**
   * Initializes the application context, bootstrapping all registered providers.
   *
   * @returns {Promise<void>}
   */
  init(): Promise<void>;

  /**
   * Gracefully shuts down the application context and disposes of all providers.
   *
   * @returns {Promise<void>}
   */
  close(): Promise<void>;

  /**
   * Enables `await using` syntax by delegating to {@link close}.
   *
   * @returns {Promise<void>}
   */
  [Symbol.asyncDispose](): Promise<void>;
}

interface GlobalUsageContext {
  /**
   * Registers one or more guards to be applied globally across all routes.
   *
   * @param {...(CanActivate|CanActivateFn)[]} guards - The guards to register globally.
   */
  useGlobalGuards(
    ...guards: (CanActivate | CanActivateFn)[]
  ): void;
}

export interface MicroserviceApplicationContext
  extends ApplicationContext, GlobalUsageContext {
  /**
   * Starts the microservice.
   */
  listen(): Promise<void>;
}

/**
 * Options for connecting a microservice to an HTTP application.
 */
export interface ConnectMicroserviceOptions {
  /**
   * When true, microservice inherits global guards from the HTTP application.
   *
   * @default false
   */
  inheritAppConfig?: boolean;
}

export interface HttpApplicationContext
  extends ApplicationContext, GlobalUsageContext {
  /**
   * Starts the HTTP server and begins accepting incoming requests.
   *
   * @todo: return a promise instead
   */
  listen(): void;

  /**
   * Connects a microservice server to this HTTP application.
   *
   * @param {MicroserviceServer<T>} server - The microservice server to connect.
   * @param {ConnectMicroserviceOptions} [options] - Connection options.
   * @returns {this} This application instance for method chaining.
   */
  connectMicroservice<T extends object = Record<string, unknown>>(
    server: MicroserviceServer<T>,
    options?: ConnectMicroserviceOptions,
  ): this;

  /**
   * Starts all connected microservices.
   *
   * @returns {Promise<void>}
   */
  startAllMicroservices(): Promise<void>;
}
