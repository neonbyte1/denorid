import type { InjectorContext, Type } from "@denorid/injector";
import { Application, type ApplicationOptions } from "./application.ts";
import type { HttpApplicationContext } from "./application_context.ts";
import type { HttpAdapter } from "./http/adapter.ts";
import type { ControllerMapping } from "./http/controller_mapping.ts";

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
      this.controller = await this.adapter.createControllerMapping(
        this.ctx,
        this.exceptionHandler,
      );

      this.logger.log("Bootstrapping application...");

      await this.ctx.onApplicationBootstrap();

      await this.controller.register(this.options.basePath);
    }
  }

  /**
   * @inheritdoc
   */
  public override async close(): Promise<void> {
    if (this.initialized) {
      await this.adapter.close();
      await super.close();
    }
  }

  /**
   * @inheritdoc
   */
  public listen(): void {
    this.adapter.listen(this.options.port);
  }
}
