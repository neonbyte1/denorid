import { InjectorContext, type Type } from "@denorid/injector";
import { Application, type ApplicationOptions } from "./application.ts";
import type {
  ApplicationContext,
  HttpApplicationContext,
} from "./application_context.ts";
import type { HttpAdapter } from "./http/adapter.ts";
import {
  HttpApplication,
  type HttpApplicationOptions,
  type InternalHttpApplicationOptions,
} from "./http_application.ts";

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

  public static async create(
    appClass: Type,
    optionsOrAdapter?:
      | ApplicationOptions
      | HttpAdapter
      | InternalHttpApplicationOptions,
    options?: HttpApplicationOptions,
  ): Promise<ApplicationContext | HttpApplicationContext> {
    const ctx = await InjectorContext.create(appClass, { useGlobals: true });
    const app = this.instantiateApplication(
      appClass,
      ctx,
      optionsOrAdapter,
      options,
    );

    if (options?.autoInitialize ?? true) {
      await app.init();
    }

    return app;
  }

  private static instantiateApplication(
    appClass: Type,
    ctx: InjectorContext,
    optionsOrAdapter?:
      | ApplicationOptions
      | HttpAdapter
      | InternalHttpApplicationOptions,
    options?: HttpApplicationOptions,
  ): ApplicationContext | HttpApplicationContext {
    if (optionsOrAdapter) {
      if ("adapter" in optionsOrAdapter) {
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
