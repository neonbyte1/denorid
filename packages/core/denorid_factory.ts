import { InjectorContext, type Type } from "@denorid/injector";
import { Logger } from "@denorid/logger";
import { Application, type ApplicationOptions } from "./application.ts";
import type {
  ApplicationContext,
  HttpApplicationContext,
  MicroserviceApplicationContext,
} from "./application_context.ts";
import { ExceptionHandler } from "./exceptions/handler.ts";
import type { HttpAdapter } from "./http/adapter.ts";
import {
  HttpApplication,
  type HttpApplicationOptions,
  type InternalHttpApplicationOptions,
} from "./http_application.ts";
import { MicroserviceApplication } from "./microservice_application.ts";
import { MicroserviceServer } from "./microservices/server.ts";

/**
 * Factory for creating and bootstrapping Denorid application instances.
 */
export class DenoridFactory {
  /**
   * Creates a plain {@link ApplicationContext} without HTTP support.
   *
   * @param {Type} appClass - The root module class to bootstrap.
   * @param {ApplicationOptions} [options] - Optional application configuration.
   * @returns {Promise<ApplicationContext>}
   */
  public static create(
    appClass: Type,
    options?: ApplicationOptions,
  ): Promise<ApplicationContext>;

  /**
   * Creates an {@link HttpApplicationContext} using the provided HTTP adapter.
   *
   * @param {Type} appClass - The root module class to bootstrap.
   * @param {HttpAdapter} adapter - The HTTP adapter to use for serving requests.
   * @param {HttpApplicationOptions} [options] - Optional HTTP application configuration.
   * @returns {Promise<HttpApplicationContext>}
   */
  public static create(
    appClass: Type,
    adapter: HttpAdapter,
    options?: HttpApplicationOptions,
  ): Promise<HttpApplicationContext>;

  /**
   * Creates an {@link HttpApplicationContext} from pre-assembled internal options.
   *
   * @param {Type} appClass - The root module class to bootstrap.
   * @param {InternalHttpApplicationOptions} options - Internal options including the adapter.
   * @returns {Promise<HttpApplicationContext>}
   */
  public static create(
    appClass: Type,
    options: InternalHttpApplicationOptions,
  ): Promise<HttpApplicationContext>;

  public static create<T extends object>(
    appClass: Type,
    server: MicroserviceServer<T>,
  ): Promise<MicroserviceApplicationContext>;

  public static async create(
    appClass: Type,
    arg1?:
      | ApplicationOptions
      | HttpAdapter
      | InternalHttpApplicationOptions
      | MicroserviceServer,
    options?: HttpApplicationOptions,
  ): Promise<ApplicationContext | HttpApplicationContext> {
    Logger.log("Bootstrapping application...", DenoridFactory.name);

    const ctx = await InjectorContext.create(appClass, {
      useGlobals: true,
      beforeInit: (ctx) => {
        ctx.registerGlobal({
          provide: ExceptionHandler,
          useValue: new ExceptionHandler(ctx),
        });
        ctx.registerGlobal({
          provide: InjectorContext,
          useValue: ctx,
        });
      },
    });
    const app = this.instantiateApplication(
      appClass,
      ctx,
      arg1,
      options,
    );

    return app;
  }

  private static instantiateApplication(
    appClass: Type,
    ctx: InjectorContext,
    optionsOrAdapter?:
      | ApplicationOptions
      | HttpAdapter
      | InternalHttpApplicationOptions
      | MicroserviceServer,
    options?: HttpApplicationOptions,
  ):
    | ApplicationContext
    | HttpApplicationContext
    | MicroserviceApplicationContext {
    if (optionsOrAdapter) {
      if (optionsOrAdapter instanceof MicroserviceServer) {
        return new MicroserviceApplication(appClass, ctx, {}, optionsOrAdapter);
      } else if ("adapter" in optionsOrAdapter) {
        return new HttpApplication(appClass, ctx, optionsOrAdapter);
      } else if ("createControllerMapping" in optionsOrAdapter) {
        return new HttpApplication(appClass, ctx, {
          ...(options ?? {}),
          adapter: optionsOrAdapter,
        });
      }
    }

    return new Application(appClass, ctx, optionsOrAdapter ?? {});
  }
}
