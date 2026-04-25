import type { InjectorContext, Type } from "@denorid/injector";
import { Logger, type LoggerService } from "@denorid/logger";
import { EXCEPTION_FILTER, EXCEPTION_FILTER_METADATA } from "../_constants.ts";
import type { HostArguments } from "../host_arguments.ts";
import type { ExceptionFilter, ExceptionFilterMetadata } from "./filter.ts";
import { IntrinsicException } from "./intrinsic.ts";

/**
 * An entry in the exception filter cache, pairing a resolved filter instance
 * with its dispatch priority.
 *
 * Higher `priority` values run first. Filters with equal priority are executed
 * in registration order.
 */
interface ExceptionFilterEntry {
  /** The resolved exception filter instance. */
  exceptionFilter: ExceptionFilter;
  /**
   * Dispatch priority for this filter. Higher values are executed first within
   * the same exception type bucket.
   */
  priority: number;
}

/**
 * Resolves and dispatches exception filters registered in the DI container.
 *
 * On {@linkcode ExceptionHandler.register}, all providers tagged with
 * `EXCEPTION_FILTER` are resolved and indexed by the exception class they
 * target. When an error is thrown, {@linkcode ExceptionHandler.handle} fans
 * out to all matching filters in priority order and collects their return
 * values.
 *
 * @example
 * ```ts
 * const handler = new ExceptionHandler(ctx);
 * await handler.register();
 *
 * if (handler.canHandle(error)) {
 *   const response = await handler.handle(error, host);
 * }
 * ```
 */
export class ExceptionHandler {
  private readonly logger: LoggerService = new Logger(ExceptionHandler.name, {
    timestamp: true,
  });
  private readonly handlers: WeakMap<Type, ExceptionFilterEntry[]> =
    new WeakMap();

  /**
   * @param {InjectorContext} ctx The injector context used to resolve exception
   * filter instances.
   */
  public constructor(private readonly ctx: InjectorContext) {}

  /**
   * Discovers and registers all exception filters found in the DI container.
   *
   * Iterates over every token tagged with `EXCEPTION_FILTER`, reads its
   * decorator metadata and-when valid-resolves the instance and inserts it
   * into the internal priority-sorted cache.
   *
   * @returns {Promise<void>} Resolves once all filters are registered.
   */
  public async register(): Promise<void> {
    for (const token of this.ctx.container.getTokensByTag(EXCEPTION_FILTER)) {
      await this.registerExceptionHandler(token as Type<ExceptionFilter>);
    }
  }

  /**
   * Returns whether a registered filter exists for the given error.
   *
   * @param {unknown} error The value thrown during request processing.
   * @returns {boolean} `true` when `error` is an `Error` instance **and** at
   * least one filter is registered for its constructor, `false` otherwise.
   */
  public canHandle(error: unknown): boolean {
    return error instanceof Error &&
      this.handlers.has((error as Error).constructor as Type);
  }

  /**
   * Dispatches `error` to all matching exception filters and collects their
   * return values.
   *
   * - Filters are called concurrently via `Promise.allSettled`.
   * - Rejected filters are logged at `fatal` level and do not interrupt other
   *   filters.
   * - `null` and `undefined` return values are discarded.
   * - When exactly one non-null/undefined value is collected it is returned
   *   directly; when multiple values are collected they are returned as an
   *   array. When `error` is not an `Error` instance, or all filters return
   *   nothing, the method returns `undefined`.
   *
   * @param {unknown} error The value thrown during request processing.
   * @param {HostArguments} host Provides access to the in-flight request/response.
   * @returns {Promise<unknown>} The collected filter result(s), or `undefined`.
   */
  public async handle(error: unknown, host: HostArguments): Promise<unknown> {
    const result: unknown[] = [];

    if (error instanceof Error) {
      if (!(error instanceof IntrinsicException)) {
        this.logger.error(error.message, error.stack);
      }

      const allSetteled = await Promise.allSettled(
        (this.handlers.get(error.constructor as Type) ?? []).map((
          { exceptionFilter },
        ) => exceptionFilter.catch(error, host)),
      );

      for (const setteled of allSetteled) {
        if (setteled.status === "rejected") {
          this.logger.fatal(
            `Unhandeld exception while listening for ${error.constructor.name}: ${setteled.reason}`,
          );
        } else if (setteled.value !== undefined && setteled.value !== null) {
          result.push(setteled.value);
        }
      }
    }

    if (result.length > 0) {
      return result.length === 1 ? result.shift() : result;
    }
  }

  /**
   * Resolves the filter class from the DI container and registers it in the
   * cache if it carries valid {@linkcode ExceptionFilterMetadata}.
   *
   * @param {Type<ExceptionFilter>} filterClass The class decorated with `@Catch`.
   * @returns {Promise<void>}
   *
   * @internal
   */
  private async registerExceptionHandler(
    filterClass: Type<ExceptionFilter>,
  ): Promise<void> {
    const metadata = filterClass[Symbol.metadata]
      ?.[EXCEPTION_FILTER_METADATA] as
        | ExceptionFilterMetadata<Error>
        | undefined;

    if (!metadata) {
      return;
    }

    const exceptionFilter = await this.ctx.resolveInternal(filterClass);

    this.registerExceptionFilterInCache(
      this.getExceptionFilterEntries(metadata.target),
      {
        exceptionFilter,
        priority: metadata.priority ?? 0,
      },
    );
  }

  /**
   * Retrieves (or lazily creates) the filter entry list for `target`.
   *
   * @param {Type} target The exception class used as the cache key.
   * @returns {ExceptionFilterEntry[]} The mutable entry list for `target`.
   *
   * @internal
   */
  private getExceptionFilterEntries(target: Type): ExceptionFilterEntry[] {
    let handlers = this.handlers.get(target);

    if (!handlers) {
      handlers = [];

      this.handlers.set(target, handlers);
    }

    return handlers;
  }

  /**
   * Inserts `entry` into `cache` at the correct position so that the array
   * remains sorted in descending priority order (highest priority first).
   *
   * @param {ExceptionFilterEntry[]} cache The target filter list, sorted descending by priority.
   * @param {ExceptionFilterEntry} entry The entry to insert.
   *
   * @internal
   */
  private registerExceptionFilterInCache(
    cache: ExceptionFilterEntry[],
    entry: ExceptionFilterEntry,
  ): void {
    const priority = entry.priority;
    const insertAt = cache.findIndex((value) => value.priority < priority);

    if (insertAt === -1) {
      cache.push(entry);
    } else {
      cache.splice(insertAt, 0, entry);
    }
  }
}
