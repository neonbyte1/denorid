import type { InjectorContext, Type } from "@denorid/injector";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import type { RequestMappingMetadata } from "./_request_mapping.ts";
import { HTTP_ROUTE_SOURCES } from "./_routes.ts";
import type { ControllerOptions } from "./controller_options.ts";
import type { HttpMethod } from "./method.ts";

/**
 * A route of the HTTP application. A route with several paths (path arrays
 * on the controller or the method) is listed once per path.
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
 * The routes of the HTTP application, e.g. to generate API documentation.
 * Injectable in every application created by `DenoridFactory`.
 *
 * The routes are listed as soon as the application is created, without
 * `app.init()`: the routes its controllers declare, with the base path and
 * the global guards added so far. Once `app.init()` registered them, the
 * registered routes are listed. The list is empty in applications without
 * HTTP adapter. In testing modules with `useCoreGlobals()`, it lists the
 * routes of their controllers without base path and global guards.
 */
export class HttpRoutes {
  /**
   * @param {InjectorContext} ctx - Injector context of the application.
   */
  public constructor(private readonly ctx: InjectorContext) {}

  /**
   * Returns the routes in registration order. The same array is returned
   * until a global guard is added or the application registers its routes.
   *
   * @return {readonly HttpRoute[]} The routes.
   */
  public list(): readonly HttpRoute[] {
    return HTTP_ROUTE_SOURCES.get(this.ctx)?.() ?? NO_ROUTES;
  }
}

/** Returned for contexts without routes. */
const NO_ROUTES: readonly HttpRoute[] = Object.freeze([]);
