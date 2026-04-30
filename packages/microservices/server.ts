import {
  type CanActivate,
  type CanActivateFn,
  type ExceptionHandler,
  ForbiddenException,
  getMessageMappingMetadata,
  getMethodGuards,
  GUARDS_METADATA,
  type HttpRouteFn,
  isClass,
  isFunction,
  MicroserviceServer,
  type PatternType,
  RpcExecutionContext,
  RpcHostArguments,
  serializePattern,
} from "@denorid/core";
import type { InjectorContext, Type } from "@denorid/injector";
import { Logger, type LoggerService } from "@denorid/logger";

/**
 * A handler entry mapping a serialized pattern to a controller method.
 */
export interface HandlerRecord {
  /** The method name to invoke on the instance. */
  methodName: string | symbol;
  /** Whether this handler expects a response (`"message"`) or not (`"event"`). */
  type: PatternType;
  /** The controller class constructor owning this handler. */
  controllerType: Type;
  /** Guards defined on the controller class via `@UseGuards`. */
  controllerGuards: (Type<CanActivate> | CanActivate | CanActivateFn)[];
  /** Guards defined on this specific handler method via `@UseGuards`. */
  methodGuards: (Type<CanActivate> | CanActivate | CanActivateFn)[];
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

  private ctx!: InjectorContext;
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
  public override registerHandlers(types: Type[], ctx: InjectorContext): void {
    this.ctx = ctx;

    for (const type of types) {
      const mappings = getMessageMappingMetadata(type) ?? [];
      const controllerGuards = [
        ...(type[Symbol.metadata]?.[GUARDS_METADATA] as
          | Set<Type<CanActivate> | CanActivate | CanActivateFn>
          | undefined ?? new Set()),
      ];

      for (const mapping of mappings) {
        const methodGuards = [
          ...(getMethodGuards(type, mapping.name) ?? new Set()),
        ];

        this.handlers.set(serializePattern(mapping.pattern), {
          methodName: mapping.name,
          type: mapping.type,
          controllerType: type,
          controllerGuards,
          methodGuards,
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

    const contextId = crypto.randomUUID();

    return await this.ctx.runInRequestScopeAsync(contextId, async () => {
      try {
        const instance = await this.ctx.getHostModuleRef().get(
          record.controllerType,
          { contextId, strict: false },
        );

        const method =
          (instance as Record<string | symbol, unknown>)[record.methodName];

        if (typeof method !== "function") {
          throw new Error(
            `Handler "${String(record.methodName)}" is not a function`,
          );
        }

        const allGuards = [
          ...this.globalGuards,
          ...record.controllerGuards,
          ...record.methodGuards,
        ];

        if (allGuards.length > 0) {
          const executionCtx = new RpcExecutionContext(
            pattern,
            data,
            record.controllerType,
            method as unknown as HttpRouteFn,
          );

          for (const guard of allGuards) {
            let allowed: boolean;

            if (isClass<CanActivate>(guard)) {
              const guardInstance = await this.ctx.getHostModuleRef().get(
                guard,
                { contextId },
              );
              allowed = await guardInstance.canActivate(executionCtx);
            } else if (isFunction<CanActivateFn>(guard)) {
              allowed = await guard(executionCtx);
            } else {
              allowed = await guard.canActivate(executionCtx);
            }

            if (!allowed) {
              throw new ForbiddenException();
            }
          }
        }

        return await (method as (data: unknown) => unknown | Promise<unknown>)
          .call(instance, data);
      } catch (err) {
        if (this.exceptionHandler) {
          await this.exceptionHandler.handle(
            err,
            new RpcHostArguments(pattern, data),
          );
        } else {
          this.logger.error(
            `Unhandled error in handler for pattern "${pattern}"`,
            err,
          );
        }
        throw err;
        // I haven't found a solution to catch the finally :(
        // deno-coverage-ignore-start
      } finally {
        this.ctx.clearContext(contextId);
      }
      // deno-coverage-ignore-stop
    });
  }
}
