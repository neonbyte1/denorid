import type { InjectionToken, Tag } from "@denorid/injector";

export interface ApplicationContext {
  /**
   * Resolves a registered provider by its injection token.
   *
   * @param {InjectionToken<T>} token - The injection token to look up.
   * @returns {Promise<T>} The resolved provider instance.
   *
   * @throws {TokenNotFoundError} When no provider is registered for the given token.
   */
  get<T>(token: InjectionToken<T>): Promise<T>;

  /**
   * Resolves all providers that have been registered with the given tags.
   *
   * @param {...Tag[]} tags - One or more tags to filter providers by.
   * @returns {Promise<T[]>} An array of resolved provider instances matching the tags.
   */
  getByTag<T = unknown>(...tags: Tag[]): Promise<T[]>;

  /**
   * Initializes the application context, bootstrapping all registered providers.
   *
   * This is called automatically during application startup unless `autoInitialize`
   * is explicitly set to `false` in the `ApplicationOptions`.
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

export interface HttpApplicationContext extends ApplicationContext {
  /**
   * Starts the HTTP server and begins accepting incoming requests.
   */
  listen(): void;
}
