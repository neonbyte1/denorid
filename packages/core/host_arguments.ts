import type { RequestContext } from "./http/request_context.ts";
import type { Pattern } from "./microservices/pattern.ts";

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

export interface RpcArguments {
  /**
   * Returns the pattern of the incoming message.
   *
   * @return {Pattern}
   */
  getPattern(): Pattern;

  /**
   * Returns the data payload of the incoming message.
   *
   * @return {unknown}
   */
  getData(): unknown;
}

/**
 * Methods to obtain the client and payload of an incoming WebSocket message.
 */
export interface WsArguments {
  /**
   * Returns the connected client that sent the message.
   *
   * @template T - Client type of the active WebSocket adapter.
   * @return {T} The client object.
   */
  getClient<T = unknown>(): T;

  /**
   * Returns the data payload of the incoming message.
   *
   * @template T - Expected payload type.
   * @return {T} The payload.
   */
  getData<T = unknown>(): T;

  /**
   * Returns the event name of the incoming message.
   *
   * @return {string} The event name.
   */
  getPattern(): string;
}

/**
 * Provides methods for retrieving the arguments being passed to a handler.
 */
export interface HostArguments {
  switchToHttp(): HttpHostArguments;
  switchToRpc(): RpcArguments;
}
