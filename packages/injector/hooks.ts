/**
 * Interface defining method called once the host module has been initialized.
 *
 * @example Usage
 * ```ts
 * export class DatabaseModule implements OnModuleInit {
 *   public async onModuleInit(): Promise<void> {
 *     // establish connection
 *   }
 * }
 * ```
 */
export interface OnModuleInit {
  /**
   * Can be used to initialize resources or establish connections and is being
   * called once the host module has been initialized.
   *
   * @returns {Promise<void>|void}
   */
  onModuleInit(): Promise<void> | void;
}

/**
 * Interface defining method called once the application has fully started
 * and is bootstrapped. You're responsible for triggering this lifecycle
 * event by calling {@linkcode InjectorContext.onApplicationBootstrap}.
 *
 * @example Usage
 * ```ts
 * class AppModule implements OnApplicationBootstrap {
 *   public onApplicationBootstrap(): Promise<void> | void {
 *     // ...
 *   }
 * }
 *
 * const injector = await InjectorContext.create(AppModule);
 * await injector.onApplicationBootstrap();
 *
 * ```
 */
export interface OnApplicationBootstrap {
  /**
   * Can be used to seed data, establish connections, or whatever you can imagine.
   *
   * @returns {Promise<void>|void}
   */
  onApplicationBootstrap(): Promise<void> | void;
}

/**
 * Interface defining method called just before the container destroys the host module.
 * Use to perform cleanup on resources (e.g. database connections).
 *
 * @example Usage
 * ```ts
 * export class DatabaseModule implements OnModuleInit, OnModuleDestroy {
 *   public onModuleDestroy(signal?: string): Promise<void> | void {
 *     // ...
 *   }
 * }
 * ```
 */
export interface OnModuleDestroy {
  /**
   * Use to perform cleanup on resources.
   *
   * @returns {Promise<void>|void}
   */
  onModuleDestroy(): Promise<void> | void;
}

/**
 * Interface defining method to respons to system signals (e.g. when the application
 * gets shutdown by SIGTERM) before the application fully shuts down.
 * You're responsible for triggering this lifecycle event by calling
 * {@linkcode InjectorContext.onBeforeApplicationShutdown}.
 *
 * @example Usage
 * ```ts
 * class AppModule implements OnBeforeApplicationShutdown {
 *   public onBeforeApplicationShutdown(signal?: string): Promise<void> | void {
 *     // ...
 *   }
 * }
 *
 * const injector = await InjectorContext.create(AppModule);
 * await injector.onBeforeApplicationShutdown();
 */
export interface OnBeforeApplicationShutdown {
  /**
   * @param {string|undefined} signal
   * @returns {Promise<void>|void}
   */
  onBeforeApplicationShutdown(signal?: string): Promise<void> | void;
}

/**
 * Interface defining method to respond to system signals (when application  gets
 * shutdown by e.g. SIGTERM). You're responsible for triggering this lifecycle
 * event by calling {@linkcode InjectorContext.onApplicationShutdown}.
 *
 * @example Usage
 * ```ts
 * class AppModule implements OnApplicationShutdown {
 *   public onApplicationShutdown(signal?: string): Promise<void> | void {
 *     // ...
 *   }
 * }
 *
 * const injector = await InjectorContext.create(AppModule);
 * await injector.onApplicationShutdown();
 */
export interface OnApplicationShutdown {
  /**
   * @param {string|Deno.Signal|undefined} signal
   */
  onApplicationShutdown(signal?: string): Promise<void> | void;
}
