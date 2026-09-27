import type { InjectorContext } from "@denorid/injector";
import type { HttpRoute } from "./routes.ts";

/**
 * Routes registered by the HTTP application of an injector context, set by
 * `HttpApplication` once its controller mapping registered them and read by
 * `HttpRoutes`.
 */
export const REGISTERED_HTTP_ROUTES: WeakMap<
  InjectorContext,
  readonly HttpRoute[]
> = new WeakMap();
