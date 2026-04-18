import type {
  InjectionToken,
  InjectorContext,
  ModuleRefContextOptions,
  ModuleRefOptions,
  Tag,
  Type,
} from "@denorid/injector";
import { Logger, type LoggerService, type LogLevel } from "@denorid/logger";
import type { ApplicationContext } from "./application_context.ts";
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
  /** Whether {@link init} has already been called on this application. */
  protected initialized?: boolean;

  /** Logger instance used for internal application messages. */
  protected readonly logger: LoggerService;

  /** Exception handler used to process unhandled errors. */
  protected readonly exceptionHandler: ExceptionHandler;

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

    this.exceptionHandler = new ExceptionHandler(ctx);
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

  /**
   * @inheritdoc
   */
  public async init(): Promise<void> {
    if (!this.initialized) {
      await this.ctx.onApplicationBootstrap();

      this.initialized = true;
    }
  }

  /**
   * @inheritdoc
   */

  public async close(): Promise<void> {
    if (this.initialized) {
      this.initialized = false;

      await this.ctx.onBeforeApplicationShutdown();
      await this.ctx.onApplicationShutdown();
    }
  }

  // deno-coverage-ignore-stop
}
