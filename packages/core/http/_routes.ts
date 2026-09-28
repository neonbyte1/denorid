import type { InjectorContext, Type } from "@denorid/injector";
import {
  CONTROLLER_METADATA,
  CONTROLLER_REQUEST_MAPPING,
} from "../_constants.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import { GUARDS_METADATA } from "../guards/decorator.ts";
import type { RequestMappingMetadata } from "./_request_mapping.ts";
import type { ControllerOptions } from "./controller_options.ts";
import type { HttpMethod } from "./method.ts";
import type { HttpRoute } from "./routes.ts";

/** A guard as accepted by `@UseGuards()` and `useGlobalGuards()`. */
type Guard = Type<CanActivate> | CanActivate | CanActivateFn;

/**
 * Routes registered by the HTTP application of an injector context, set by
 * `HttpApplication` once its controller mapping registered them and read by
 * `HttpRoutes`.
 */
export const REGISTERED_HTTP_ROUTES: WeakMap<
  InjectorContext,
  readonly HttpRoute[]
> = new WeakMap();

/** The route entries of a controller class, read from its metadata. */
export interface ControllerRoutes {
  /**
   * Base paths of the routes: the application base path joined with every
   * controller path (a controller without path counts as one empty path).
   */
  basePaths: string[];
  /** Controller guards (`@UseGuards()` on the class). */
  guards: Guard[];
  /** Route entries with an HTTP method, in declaration order. */
  routes: (RequestMappingMetadata & { method: HttpMethod })[];
  /** Host restriction of the controller, when it has one. */
  host?: ControllerOptions["host"];
}

/**
 * Normalizes a path value to an array of path strings.
 *
 * @param {string | string[] | undefined} path - The raw path value from
 *   controller or route metadata.
 * @return {string[]} An array of path strings, or an empty array if
 *   undefined.
 */
export function normalizePaths(path: string | string[] | undefined): string[] {
  return path !== undefined ? Array.isArray(path) ? path : [path] : [];
}

/**
 * Joins multiple path segments into a single normalized path.
 *
 * Leading and trailing slashes are stripped from each segment before
 * joining, and a single leading slash is added to the result.
 *
 * @param {...string} parts - The path segments to join.
 * @return {string} The normalized combined path (e.g. `"/foo/bar"`).
 */
export function joinPaths(...parts: string[]): string {
  return `/${
    parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")
  }`;
}

/**
 * Reads the route entries of a controller class. Entries without an HTTP
 * method (only `@HttpCode()`, `@Body()`, `@Form()`, `@Query()`, `@Params()`,
 * `@RequestHeaders()` or `@UseGuards()` on a method) are not routes and are
 * left out.
 *
 * @param {Type} controllerClass - The controller class.
 * @param {string} basePath - The global path prefix.
 * @return {ControllerRoutes} The route entries of the controller.
 */
export function readControllerRoutes(
  controllerClass: Type,
  basePath: string,
): ControllerRoutes {
  const metadata = controllerClass[Symbol.metadata];
  const options = metadata?.[CONTROLLER_METADATA] as ControllerOptions;
  const controllerPaths = normalizePaths(options.path);
  const guards = metadata?.[GUARDS_METADATA] as Set<Guard> | undefined;

  return {
    basePaths: (controllerPaths.length > 0 ? controllerPaths : [""]).map(
      (controllerPath) => joinPaths(basePath, controllerPath),
    ),
    guards: [...(guards ?? [])],
    routes: (
      (metadata?.[CONTROLLER_REQUEST_MAPPING] ?? []) as RequestMappingMetadata[]
    ).filter((route): route is RequestMappingMetadata & {
      method: HttpMethod;
    } => route.method !== undefined),
    ...(options.host !== undefined ? { host: options.host } : {}),
  };
}

/**
 * Creates the routes of a controller: one per base path and entry of the
 * route path, with the `host` of the controller when it has one.
 *
 * @param {Type} controllerClass - The controller class.
 * @param {ControllerRoutes} controller - Its route entries.
 * @param {readonly Guard[]} globalGuards - The global guards.
 * @return {HttpRoute[]} The routes in registration order.
 */
export function createControllerHttpRoutes(
  controllerClass: Type,
  controller: ControllerRoutes,
  globalGuards: readonly Guard[],
): HttpRoute[] {
  const host = controller.host !== undefined ? { host: controller.host } : {};
  const routes: HttpRoute[] = [];

  for (const basePath of controller.basePaths) {
    for (const route of controller.routes) {
      const guards = [
        ...new Set([
          ...globalGuards,
          ...controller.guards,
          ...(route.guards ?? []),
        ]),
      ];
      const routePaths = normalizePaths(route.path);

      for (const routePath of routePaths.length > 0 ? routePaths : [""]) {
        routes.push({
          method: route.method,
          path: joinPaths(basePath, routePath),
          controller: controllerClass,
          ...host,
          metadata: route,
          guards,
        });
      }
    }
  }

  return routes;
}
