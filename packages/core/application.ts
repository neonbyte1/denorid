import type {
  InjectionToken,
  InjectorContext,
  ModuleRefContextOptions,
  ModuleRefOptions,
  Tag,
  Type,
} from "@denorid/injector";
import { Logger, type LoggerService, type LogLevel } from "@denorid/logger";
import process from "node:process";
import type { ApplicationContext } from "./application_context.ts";
import {
  ConsoleCommandRunner,
  type ConsoleCommandRunnerOptions,
} from "./cli/command_runner.ts";
import { ExceptionHandler } from "./exceptions/handler.ts";

/**
 * Configuration options for bootstrapping an {@link Application}.
 */
export interface ApplicationOptions {
  /** Custom logger service to use instead of the default {@link Logger}. */
  logger?: LoggerService;

  /**
   * Log levels to enable on the default logger.
   *
   * @default ["log", "warn", "error", "fatal"]
   */
  logLevel?: LogLevel[];
}

/**
 * Base application class that implements {@link ApplicationContext} and wires together
 * the injector context, logger, and exception handler.
 *
 * @template Options - The application options type, defaults to {@link ApplicationOptions}.
 * Any custom configuration must extends {@link ApplicationOptions}.
 */
export class Application<
  Options extends ApplicationOptions = ApplicationOptions,
> implements ApplicationContext {
  /**
   * Whether {@link init} has been called on this application, also while it
   * runs and after it failed.
   */
  protected initialized?: boolean;

  /**
   * Settles with the running or completed {@link init}. Cleared when it
   * rejects, so a later call initializes again.
   */
  protected initializing?: Promise<void>;

  /** Settles when the application is closed, set by the first {@link close}. */
  protected closing?: Promise<void>;

  /** Logger instance used for internal application messages. */
  protected readonly logger: LoggerService;

  /** Exception handler used to process unhandled errors. */
  protected exceptionHandler!: ExceptionHandler;

  /**
   * @param {Type} metaType - The root module class used to derive the logger name.
   * @param {InjectorContext} ctx - The injector context for resolving providers.
   * @param {Options} options - Options to configure the application.
   */
  public constructor(
    protected readonly metaType: Type,
    protected readonly ctx: InjectorContext,
    options: Options,
  ) {
    this.logger = options?.logger ??
      new Logger(metaType.name, { levels: options?.logLevel, timestamp: true });
  }

  // We don't need to test the injector twice, so ignore the coverage here.
  // deno-coverage-ignore-start

  /**
   * @inheritdoc
   */
  public get<T>(
    token: InjectionToken<T>,
    options?: ModuleRefOptions,
  ): Promise<T>;
  /**
   * @inheritdoc
   */
  public get<T>(
    token: InjectionToken<T>,
    options: ModuleRefContextOptions,
  ): Promise<T>;
  public get<T>(
    token: InjectionToken<T>,
    options?: ModuleRefOptions | ModuleRefContextOptions,
  ): Promise<T> {
    return this.ctx.getHostModuleRef().get<T>(
      token,
      options as ModuleRefContextOptions,
    );
  }

  /**
   * @inheritdoc
   */
  public getByTag<T = unknown>(
    tag: Tag,
    options?: ModuleRefOptions,
  ): Promise<T[]>;
  /**
   * @inheritdoc
   */
  public getByTag<T = unknown>(
    tags: Tag[],
    options: ModuleRefContextOptions,
  ): Promise<T[]>;
  public async getByTag<T>(
    arg0: Tag | Tag[],
    options?: ModuleRefOptions | ModuleRefContextOptions,
  ): Promise<T[]> {
    if (Array.isArray(arg0)) {
      return (await Promise.all(
        arg0.map((tag) => this.getByTag<T>(tag, options)),
      ))
        .flat();
    }

    return this.ctx.getHostModuleRef().getByTag<T>(arg0, options);
  }

  // deno-coverage-ignore-stop

  /**
   * Initializes the application once: resolves the exception handler,
   * registers the exception filters, then runs {@link bootstrap}. Concurrent
   * and later calls share the same promise; after a rejection the next call
   * starts over.
   *
   * @returns {Promise<void>} Resolves when the application is initialized.
   * @throws {Error} When the application was closed before it was
   * initialized.
   */
  public init(): Promise<void> {
    if (!this.initializing) {
      if (this.closing) {
        return Promise.reject(
          new Error("Cannot initialize an application that was closed"),
        );
      }

      this.initialized = true;
      this.initializing = this.initialize().catch((error: unknown) => {
        this.initializing = undefined;
        throw error;
      });
    }

    return this.initializing;
  }

  /**
   * Runs after the exception filters are registered: fires
   * `onApplicationBootstrap`. Subclasses wire their transports around it and
   * call `super.bootstrap()`.
   *
   * @returns {Promise<void>} Resolves when the application is bootstrapped.
   */
  protected async bootstrap(): Promise<void> {
    await this.ctx.onApplicationBootstrap();
  }

  /**
   * Closes the application once, after a running {@link init} settled, so
   * {@link shutdown} also stops what that call started.
   *
   * @returns {Promise<void>} Resolves when the application is shut down.
   */
  public close(): Promise<void> {
    this.closing ??= this.shutdownAfterInit();

    return this.closing;
  }

  /**
   * Stops what the application started and closes the injector context, which
   * runs the shutdown hooks and disposes the providers it created. Runs once,
   * whether or not {@link init} was called: creating the application already
   * initialized the modules. Subclasses stop their servers first and call
   * `super.shutdown()` last, also when stopping them fails.
   *
   * @returns {Promise<void>} Resolves when the application is shut down.
   */
  protected async shutdown(): Promise<void> {
    await this.ctx.close();
  }

  /**
   * @inheritdoc
   */
  public [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  /**
   * @inheritdoc
   */
  public async runCommandLine(
    argv: string[] = process.argv.slice(2),
    options?: ConsoleCommandRunnerOptions,
  ): Promise<number> {
    await this.init();
    try {
      const runner = new ConsoleCommandRunner(this.ctx, {
        appName: this.metaType.name,
        ...options,
      });
      return await runner.run(argv);
    } finally {
      await this.close();
    }
  }

  /**
   * Resolves the exception handler, registers the exception filters before
   * any `onApplicationBootstrap` hook can raise an error, then bootstraps.
   *
   * @returns {Promise<void>} Resolves when the application is initialized.
   */
  private async initialize(): Promise<void> {
    this.exceptionHandler = await this.ctx.resolveInternal(ExceptionHandler);

    await this.exceptionHandler.register();
    await this.bootstrap();
  }

  /**
   * Waits for a running {@link init} to settle, whatever its outcome, then
   * shuts down.
   *
   * @returns {Promise<void>} Resolves when the application is shut down.
   */
  private async shutdownAfterInit(): Promise<void> {
    await this.initializing?.catch((): void => {});
    await this.shutdown();
  }
}
