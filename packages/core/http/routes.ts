import type { InjectorContext, Type } from "@denorid/injector";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import type { RequestMappingMetadata } from "./_request_mapping.ts";
import { REGISTERED_HTTP_ROUTES } from "./_routes.ts";
import type { ControllerOptions } from "./controller_options.ts";
import type { HttpMethod } from "./method.ts";

/**
 * A route registered by the HTTP application. A route with several paths
 * (path arrays on the controller or the method) is listed once per path.
 */
export interface HttpRoute {
  /** HTTP method of the route. */
  readonly method: HttpMethod;
  /**
   * Full path as registered with the adapter: the application base path, the
   * controller path and the route path joined, e.g. `/api/users/:id`.
   */
  readonly path: string;
  /** Controller class declaring the route. */
  readonly controller: Type;
  /**
   * Host restriction of the controller (`@Controller({ host })`); the
   * property is absent when the route serves every host.
   */
  readonly host?: ControllerOptions["host"];
  /**
   * Route entry of the controller method: method name, status code, body,
   * query, path parameter and header schemas and method guards.
   */
  readonly metadata: Readonly<RequestMappingMetadata>;
  /**
   * Guards evaluated before the handler: global, controller and method
   * guards, in this order and without duplicates.
   */
  readonly guards: readonly (Type<CanActivate> | CanActivate | CanActivateFn)[];
}

/**
 * The routes registered by the HTTP application, e.g. to generate API
 * documentation. Injectable in every application created by
 * `DenoridFactory`.
 *
 * The list is filled while the application initializes (`app.init()` or
 * `app.listen()`), after the `onApplicationBootstrap` hooks ran; it is empty
 * before and in applications without HTTP adapter.
 */
export class HttpRoutes {
  /**
   * @param {InjectorContext} ctx - Injector context of the application.
   */
  public constructor(private readonly ctx: InjectorContext) {}

  /**
   * Returns the registered routes in registration order. The same array is
   * returned until the application registers its routes again.
   *
   * @return {readonly HttpRoute[]} The registered routes.
   */
  public list(): readonly HttpRoute[] {
    return REGISTERED_HTTP_ROUTES.get(this.ctx) ?? NO_ROUTES;
  }
}

/** Returned while no routes are registered. */
const NO_ROUTES: readonly HttpRoute[] = Object.freeze([]);
