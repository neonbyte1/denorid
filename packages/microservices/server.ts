import {
  type CanActivate,
  type CanActivateFn,
  type ExceptionHandler,
  ForbiddenException,
  getMessageMappingMetadata,
  type HttpRouteFn,
  isFunction,
  MicroserviceServer,
  type PatternType,
  serializePattern,
} from "@denorid/core";
import type { Type } from "@denorid/injector";
import { Logger, type LoggerService } from "@denorid/logger";
import { MicroserviceExecutionContext } from "./execution_context.ts";
import { MicroserviceHostArguments } from "./host_arguments.ts";

/**
 * A resolved handler entry mapping a serialized pattern to a controller method.
 */
export interface HandlerRecord {
  /** The resolved controller instance. */
  instance: unknown;
  /** The method name to invoke on the instance. */
  methodName: string | symbol;
  /** Whether this handler expects a response (`"message"`) or not (`"event"`). */
  type: PatternType;
  /** The controller class constructor owning this handler. */
  controllerType: Type;
}

/**
 * Abstract base class for all transport-specific microservice servers.
 *
 * Handles handler registration and dispatch; subclasses implement
 * the transport-specific `listen()` and `close()`.
 *
 * @template Options - Transport-specific options type.
 */
export abstract class Server<
  Options extends object = Record<string, unknown>,
> extends MicroserviceServer<Options> {
  protected readonly logger: LoggerService = new Logger(Server.name, {
    timestamp: true,
  });

  /** Serialized-pattern → handler map populated by {@link registerHandlers}. */
  protected readonly handlers: Map<string, HandlerRecord> = new Map();

  private exceptionHandler?: ExceptionHandler;
  private globalGuards: (CanActivate | CanActivateFn)[] = [];

  /**
   * @inheritdoc
   */
  public override setExceptionHandler(handler: ExceptionHandler): void {
    this.exceptionHandler = handler;
  }

  /**
   * @inheritdoc
   */
  public override setGlobalGuards(
    guards: (CanActivate | CanActivateFn)[],
  ): void {
    this.globalGuards = guards;
  }

  /**
   * @inheritdoc
   */
  public override registerHandlers(types: Type[], instances: unknown[]): void {
    for (let i = 0; i < types.length; ++i) {
      const type = types[i];
      const instance = instances[i];
      const mappings = getMessageMappingMetadata(type) ?? [];

      for (const mapping of mappings) {
        this.handlers.set(serializePattern(mapping.pattern), {
          instance,
          methodName: mapping.name,
          type: mapping.type,
          controllerType: type,
        });
      }
    }
  }

  /**
   * Dispatches incoming data to the handler registered for `pattern`.
   *
   * @param {string} pattern - The serialized pattern to look up.
   * @param {unknown} data - The payload forwarded to the handler.
   * @return {Promise<unknown>} The handler's return value.
   * @throws {Error} When no handler is registered for `pattern` or the resolved method is not a function.
   */
  protected async dispatch(pattern: string, data: unknown): Promise<unknown> {
    const record = this.handlers.get(pattern);

    if (!record) {
      throw new Error(`No handler registered for pattern "${pattern}"`);
    }

    const method =
      (record.instance as Record<string | symbol, unknown>)[record.methodName];

    if (typeof method !== "function") {
      throw new Error(
        `Handler "${String(record.methodName)}" is not a function`,
      );
    }

    if (this.globalGuards.length > 0) {
      const executionCtx = new MicroserviceExecutionContext(
        pattern,
        data,
        record.controllerType,
        method as unknown as HttpRouteFn,
      );

      for (const guard of this.globalGuards) {
        const allowed = isFunction<CanActivateFn>(guard)
          ? await guard(executionCtx)
          : await guard.canActivate(executionCtx);

        if (!allowed) {
          throw new ForbiddenException();
        }
      }
    }

    try {
      return await (method as (data: unknown) => unknown | Promise<unknown>)
        .call(record.instance, data);
    } catch (err) {
      if (this.exceptionHandler) {
        await this.exceptionHandler.handle(
          err,
          new MicroserviceHostArguments(pattern, data),
        );
      } else {
        this.logger.error(
          `Unhandled error in handler for pattern "${pattern}"`,
          err,
        );
      }
      throw err;
    }
  }
}
