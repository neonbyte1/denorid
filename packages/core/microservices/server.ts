import type { ExceptionHandler } from "../exceptions/handler.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import type { InjectorContext, Type } from "@denorid/injector";

/**
 * Base class for microservice server transports.
 *
 * @template Options - Transport-specific configuration object.
 */
export abstract class MicroserviceServer<
  Options extends object = Record<string, unknown>,
> {
  public constructor(protected readonly options: Options) {}

  /**
   * Starts the server. Resolves once it accepts messages and rejects when it
   * cannot start, after releasing what it opened. Once started, the server
   * keeps itself running (and handles later failures itself) until
   * {@link close} is called.
   *
   * @return {Promise<void>} Resolves when the server is ready.
   */
  public abstract listen(): Promise<void>;

  /**
   * Stops the server, waits for running handlers and releases all held
   * resources. Safe to call before, during and after {@link listen}.
   *
   * @return {Promise<void>}
   */
  public abstract close(): Promise<void>;

  /**
   * Receives the application-level exception handler after DI is initialised.
   *
   * @param {ExceptionHandler} handler - The exception handler to use when dispatching errors.
   * @return {void}
   */
  public abstract setExceptionHandler(handler: ExceptionHandler): void;

  /**
   * Registers pattern-to-handler mappings discovered from the DI container.
   *
   * @param {Type[]} types - Controller class constructors (used to read `Symbol.metadata`).
   * @param {InjectorContext} ctx - The injector context used to resolve instances lazily per dispatch.
   * @return {void}
   */
  public abstract registerHandlers(types: Type[], ctx: InjectorContext): void;

  /**
   * Registers global guards applied before every handler invocation.
   *
   * @param {(CanActivate|CanActivateFn)[]} guards - Guards to apply globally.
   * @return {void}
   */
  public abstract setGlobalGuards(
    guards: (CanActivate | CanActivateFn)[],
  ): void;
}
