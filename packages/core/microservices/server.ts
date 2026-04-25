import type { ExceptionHandler } from "../exceptions/handler.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import type { Type } from "@denorid/injector";

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
   * Starts the server and begins accepting incoming messages.
   *
   * @return {Promise<void>}
   */
  public abstract listen(): Promise<void>;

  /**
   * Stops the server and releases all held resources.
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
   * @param {unknown[]} instances - Resolved instances, parallel to `types`.
   * @return {void}
   */
  public abstract registerHandlers(types: Type[], instances: unknown[]): void;

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
