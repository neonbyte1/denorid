import type { RequestContext } from "./http/request_context.ts";

/**
 * Methods to obtain request and response objects.
 */
export interface HttpHostArguments {
  /**
   * Returns the in-flight `request` object.
   *
   * @returns The current request context where you can access the
   * underlying context.
   */
  getRequest(): RequestContext;

  /**
   * Returns the in-flight `response` object.
   *
   * @template {unknown} T
   *
   * @returns {T} The response object, where the actual type depends on the underlying
   * implementation. For example: hono doesn't have a "Response" interface, because
   * the so called `Context` holds the response and methods to set or modify the response.
   *
   * Use this function with caution.
   */
  getResponse<T = unknown>(): T;
}

/**
 * Provides methods for retrieving the arguments being passed to a handler.
 */
export interface HostArguments {
  switchToHttp(): HttpHostArguments;
}
