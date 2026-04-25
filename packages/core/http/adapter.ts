import type { InjectorContext } from "@denorid/injector";
import type { ExceptionHandler } from "../exceptions/handler.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import type { ControllerMapping } from "./controller_mapping.ts";
import type { CorsOptions } from "./cors.ts";

/** Options passed to {@link HttpAdapter.createControllerMapping} to configure route registration. */
export interface ControllerMappingOptions {
  /** The injector context providing controller instances. */
  ctx: InjectorContext;
  /** Handler invoked when a route throws. */
  exceptionHandler: ExceptionHandler;
  /** CORS policy applied to every registered route. Pass `false` or `undefined` to disable. */
  cors: boolean | CorsOptions | undefined;
  /** Global guards evaluated before every route handler. */
  globalGuards: (CanActivate | CanActivateFn)[];
}

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
   * Registers all controllers from the given options and returns
   * the resulting route mapping for the adapter.
   *
   * @param {ControllerMappingOptions} opts - Options used to configure the controller mapping.
   * @return {ControllerMapping | Promise<ControllerMapping>} The constructed mapping.
   */
  createControllerMapping(
    opts: ControllerMappingOptions,
  ): ControllerMapping | Promise<ControllerMapping>;
}
