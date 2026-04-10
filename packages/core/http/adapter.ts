import type { InjectorContext } from "@denorid/injector";
import type { ExceptionHandler } from "../exceptions/handler.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import type { ControllerMapping } from "./controller_mapping.ts";

/**
 * Defines the contract for an HTTP adapter used by the Denorid framework.
 *
 * Implementations are responsible for binding to a port, tearing down the
 * server, and wiring controller routes into the underlying HTTP engine.
 */
export interface HttpAdapter {
  /**
   * Starts the HTTP server and begins accepting incoming connections.
   *
   * @param {number} [port] - The port to listen on. Defaults to 3000 when omitted.
   */
  listen(port?: number): void;

  /**
   * Gracefully shuts down the HTTP server and releases its resources.
   *
   * @return {Promise<void>} Resolves when the server has fully stopped.
   */
  close(): Promise<void>;

  /**
   * Registers all controllers from the given injector context and returns
   * the resulting route mapping for the adapter.
   *
   * @param {InjectorContext} ctx - The injector context providing controller instances.
   * @param {ExceptionHandler} exceptionHandler - Handler invoked when a route throws.
   * @return {ControllerMapping | Promise<ControllerMapping>} The constructed mapping.
   */
  createControllerMapping(
    ctx: InjectorContext,
    exceptionHandler: ExceptionHandler,
    globalGuards: (CanActivate | CanActivateFn)[],
  ): ControllerMapping | Promise<ControllerMapping>;
}
