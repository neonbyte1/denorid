import type {
  InjectionToken,
  ModuleRefContextOptions,
  ModuleRefOptions,
  Tag,
} from "@denorid/injector";
import type { CanActivate, CanActivateFn } from "./guards/can_activate.ts";

/**
 * Interface defining the core application context.
 */
export interface ApplicationContext {
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
}

/**
 * Interface defining the `useGlobalGuards` function that must be implemented by
 * an application.
 */
export interface GlobalGuardContext {
  /**
   * Registers one or more guards to be applied globally across all routes.
   *
   * @param {...(CanActivate|CanActivateFn)[]} guards - The guards to register globally.
   */
  useGlobalGuards(
    ...guards: (CanActivate | CanActivateFn)[]
  ): void;
}

export interface HttpApplicationContext
  extends ApplicationContext, GlobalGuardContext {
  /**
   * Starts the HTTP server and begins accepting incoming requests.
   */
  listen(): void;
}
