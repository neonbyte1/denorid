import type { InjectorContext, Type } from "@denorid/injector";
import type { Server as NodeHttpServer } from "node:http";
import { MESSAGE_CONTROLLER_METADATA } from "./_constants.ts";
import { Application, type ApplicationOptions } from "./application.ts";
import type {
  ConnectMicroserviceOptions,
  HttpApplicationContext,
} from "./application_context.ts";
import type { CanActivate, CanActivateFn } from "./guards/can_activate.ts";
import { collectHttpRoutes, HTTP_ROUTE_SOURCES } from "./http/_routes.ts";
import type { HttpAdapter } from "./http/adapter.ts";
import type { CorsOptions } from "./http/cors.ts";
import type { HttpRoute } from "./http/routes.ts";
import type { MicroserviceServer } from "./microservices/server.ts";
import { GatewayRuntime } from "./websockets/_gateway_runtime.ts";
import type { WebSocketAdapter } from "./websockets/adapter.ts";

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
 * HTTP-capable application that extends {@link Application} with route mapping,
 * WebSocket gateways and an underlying {@link HttpAdapter}.
 */
export class HttpApplication extends Application<InternalHttpApplicationOptions>
  implements HttpApplicationContext {
  private readonly options: HttpCoreApplicationOptions;
  private readonly adapter: HttpAdapter;
  /** Settles when the server was started, set by {@link listen}. */
  private listening?: Promise<void>;
  private webSocketAdapter?: WebSocketAdapter;
  private gateways?: GatewayRuntime;
  /**
   * Routes declared by the controllers with the current global guards,
   * listed by `HttpRoutes` until the routes are registered. Cleared when a
   * global guard is added.
   */
  private declaredRoutes?: readonly HttpRoute[];
  /** Routes registered by the last successful {@link bootstrap}. */
  private registeredRoutes?: readonly HttpRoute[];

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

    this.options = {
      port: options.port,
      basePath: options.basePath,
      cors: options.cors,
    };
    this.adapter = options.adapter;

    HTTP_ROUTE_SOURCES.set(
      ctx,
      (): readonly HttpRoute[] =>
        this.registeredRoutes ??
          (this.declaredRoutes ??= collectHttpRoutes(
            ctx,
            this.options.basePath ?? "",
            [...this.globalGuards],
          )),
    );
  }

  /**
   * Creates the controller mapping, connects the WebSocket gateways, fires
   * `onApplicationBootstrap`, then registers the routes, which `HttpRoutes`
   * lists from then on (a later bootstrap replaces them).
   *
   * @returns {Promise<void>} Resolves when the application is bootstrapped.
   */
  protected override async bootstrap(): Promise<void> {
    // A failed earlier init may have connected gateways: release them before
    // connecting again.
    await this.gateways?.close();

    const controller = await this.adapter.createControllerMapping({
      ctx: this.ctx,
      exceptionHandler: this.exceptionHandler,
      cors: this.options.cors,
      globalGuards: [...this.globalGuards],
    });

    this.gateways = new GatewayRuntime({
      ctx: this.ctx,
      exceptionHandler: this.exceptionHandler,
      globalGuards: [...this.globalGuards],
      logger: this.logger,
    });
    await this.gateways.connect((): WebSocketAdapter | undefined =>
      this.webSocketAdapter ?? this.adapter.createWebSocketAdapter?.()
    );

    await super.bootstrap();

    this.registeredRoutes = await controller.register(this.options.basePath);
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

    this.declaredRoutes = undefined;
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
  public useWebSocketAdapter(adapter: WebSocketAdapter): this {
    this.webSocketAdapter = adapter;
    return this;
  }

  /**
   * @inheritdoc
   */
  public getHttpServer(): NodeHttpServer {
    if (!this.adapter.getHttpServer) {
      throw new Error(
        "The HTTP adapter does not provide a node:http server " +
          "(HttpAdapter.getHttpServer() is not implemented).",
      );
    }

    return this.adapter.getHttpServer();
  }

  /**
   * Initializes the application, then starts every connected microservice,
   * one after another. When a server fails to start, it is closed together
   * with the servers started before it and the error is rethrown. Nothing is
   * started once {@link close} was called.
   *
   * @returns {Promise<void>} Resolves when every server is listening.
   */
  public async startAllMicroservices(): Promise<void> {
    if (this.microservices.size === 0 || this.closing) {
      return;
    }

    await this.init();

    const tokens = this.ctx.container.getTokensByTag(
      MESSAGE_CONTROLLER_METADATA,
      true,
    );
    const types = tokens as Type[];
    const started: MicroserviceServer<object>[] = [];

    for (const [server, options] of this.microservices) {
      // `close()` may have been called while a server started.
      if (this.closing) {
        return;
      }

      try {
        server.setExceptionHandler(this.exceptionHandler);
        server.setGlobalGuards(
          options.inheritAppConfig ? [...this.globalGuards] : [],
        );
        server.registerHandlers(types, this.ctx);
        started.push(server);
        await server.listen();
      } catch (error) {
        await Promise.all(started.map((s) => s.close().catch(() => {})));
        throw error;
      }
    }
  }

  /**
   * @inheritdoc
   */
  protected override async shutdown(): Promise<void> {
    try {
      if (this.initialized) {
        await Promise.all(
          [...this.microservices.keys()].map((s) => s.close().catch(() => {})),
        );
        await this.gateways?.close();
        await this.adapter.close();
      }
    } finally {
      await super.shutdown();
    }
  }

  /**
   * Initializes the application, then starts the HTTP server. Repeated calls
   * are ignored. The server is started only once the initialization
   * succeeded and never after {@link close} was called. When the
   * initialization fails, its error is rethrown as an unhandled rejection and
   * a later call tries again.
   */
  public listen(): void {
    if (this.listening || this.closing) {
      return;
    }

    this.listening = this.init().then(
      (): void => {
        // `close()` may have been called while the application initialized.
        if (!this.closing) {
          this.adapter.listen(this.options.port);
        }
      },
      (error: unknown): never => {
        this.listening = undefined;
        throw error;
      },
    );
  }
}
