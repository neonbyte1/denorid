import type { InjectorContext, Type } from "@denorid/injector";
import { MESSAGE_CONTROLLER_METADATA } from "./_constants.ts";
import { Application, type ApplicationOptions } from "./application.ts";
import type {
  ConnectMicroserviceOptions,
  HttpApplicationContext,
} from "./application_context.ts";
import { ExceptionHandler } from "./exceptions/handler.ts";
import type { CanActivate, CanActivateFn } from "./guards/can_activate.ts";
import type { HttpAdapter } from "./http/adapter.ts";
import type { ControllerMapping } from "./http/controller_mapping.ts";
import type { CorsOptions } from "./http/cors.ts";
import type { MicroserviceServer } from "./microservices/server.ts";

/**
 * Core HTTP-specific configuration options for an HTTP application.
 */
export interface HttpCoreApplicationOptions {
  /**
   * Port number for the HTTP server to listen on.
   *
   * @default 3000
   */
  port?: number;

  /**
   * Base path prefix applied to all registered routes.
   *
   * @default ""
   */
  basePath?: string;
  /**
   * CORS configuration for the HTTP server.
   *
   * Set to `true` to enable CORS with default options, `false` or omit to
   * disable it, or provide a {@link CorsOptions} object for fine-grained
   * control over allowed origins, methods, and headers.
   *
   * @default false
   */
  cors?: boolean | CorsOptions;
}

/**
 * Public configuration options for an HTTP application.
 * Combines base {@link ApplicationOptions} with HTTP-specific settings.
 */
export type HttpApplicationOptions =
  & ApplicationOptions
  & HttpCoreApplicationOptions;

/**
 * Internal options passed to {@link HttpApplication} that additionally require
 * a concrete {@link HttpAdapter} implementation.
 */
export interface InternalHttpApplicationOptions extends HttpApplicationOptions {
  /**
   * The HTTP adapter responsible for handling requests and routing.
   */
  adapter: HttpAdapter;
}

/**
 * HTTP-capable application that extends {@link Application} with route mapping
 * and an underlying {@link HttpAdapter}.
 */
export class HttpApplication extends Application<InternalHttpApplicationOptions>
  implements HttpApplicationContext {
  private readonly options: HttpCoreApplicationOptions;
  private readonly adapter: HttpAdapter;
  private controller?: ControllerMapping;
  private listening?: "pending" | "active";

  private readonly globalGuards: Set<CanActivate | CanActivateFn> = new Set();
  private readonly microservices: Map<
    MicroserviceServer<object>,
    ConnectMicroserviceOptions
  > = new Map();

  /**
   * @param {Type} target - The root module class used to derive the logger name.
   * @param {InjectorContext} ctx - The injector context for resolving providers.
   * @param {InternalHttpApplicationOptions} options - HTTP application options including the adapter.
   */
  public constructor(
    target: Type,
    ctx: InjectorContext,
    options: InternalHttpApplicationOptions,
  ) {
    super(target, ctx, options);

    this.options = { port: options.port, basePath: options.basePath };
    this.adapter = options.adapter;
  }

  /**
   * @inheritdoc
   */
  public override async init(): Promise<void> {
    if (!this.initialized) {
      this.initialized = true;

      this.exceptionHandler = await this.ctx.resolveInternal(ExceptionHandler);

      this.controller = await this.adapter.createControllerMapping({
        ctx: this.ctx,
        exceptionHandler: this.exceptionHandler,
        cors: this.options.cors,
        globalGuards: [...this.globalGuards],
      });

      await this.ctx.onApplicationBootstrap();

      await this.controller.register(this.options.basePath);
    }
  }

  /**
   * @inheritdoc
   */
  public useGlobalGuards(
    ...guards: (CanActivate | CanActivateFn)[]
  ): void {
    for (const guard of guards) {
      this.globalGuards.add(guard);
    }
  }

  /**
   * @inheritdoc
   */
  public connectMicroservice<T extends object = Record<string, unknown>>(
    server: MicroserviceServer<T>,
    options: ConnectMicroserviceOptions = {},
  ): this {
    this.microservices.set(server as MicroserviceServer<object>, options);
    return this;
  }

  /**
   * @inheritdoc
   */
  public async startAllMicroservices(): Promise<void> {
    if (this.microservices.size === 0) {
      return;
    }

    await this.init();

    const tokens = this.ctx.container.getTokensByTag(
      MESSAGE_CONTROLLER_METADATA,
    );
    const types = tokens as Type[];
    const started: MicroserviceServer<object>[] = [];

    for (const [server, options] of this.microservices) {
      try {
        server.setExceptionHandler(this.exceptionHandler);
        server.setGlobalGuards(
          options.inheritAppConfig ? [...this.globalGuards] : [],
        );
        server.registerHandlers(types, this.ctx);
        const listenPromise = server.listen();
        // Race against a resolved microtask: immediate rejections surface here,
        // long-running servers' pending promises yield to the microtask instead.
        await new Promise<void>((resolve, reject) => {
          listenPromise.then(() => resolve(), reject);
          Promise.resolve().then(resolve);
        });
        listenPromise.catch(() => {});
        started.push(server);
      } catch (error) {
        await Promise.all(started.map((s) => s.close().catch(() => {})));
        throw error;
      }
    }
  }

  /**
   * @inheritdoc
   */
  public override async close(): Promise<void> {
    if (this.initialized) {
      await Promise.all(
        [...this.microservices.keys()].map((s) => s.close().catch(() => {})),
      );
      await this.adapter.close();
      await super.close();
    }
  }

  /**
   * @inheritdoc
   */
  public listen(): void {
    if (!this.initialized) {
      if (this.listening !== "active") {
        this.listening = "pending";
      }

      this.init().then(() => {
        if (this.listening === "pending") {
          this.listening = "active";

          this.adapter.listen(this.options.port);
        }
      });
    } else if (!this.listening) {
      this.listening = "active";
      this.adapter.listen(this.options.port);
    }
  }
}
