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
 * target. When an error is thrown, {@linkcode ExceptionHandler.handle} looks
 * up the error's class, then its parent classes, and fans out to all filters
 * of the first (most specific) class that has any, in priority order, and
 * collects their return values. A `@Catch(HttpException)` filter therefore
 * handles every `NotFoundException`, while a `@Catch(NotFoundException)`
 * filter takes precedence over it for that class.
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
  private handlers: WeakMap<Type, ExceptionFilterEntry[]> = new WeakMap();
  private registering?: Promise<void>;

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
   * into the internal priority-sorted cache. Runs once: later calls return
   * the first call's result, unless it rejected, in which case the next call
   * discovers the filters again.
   *
   * @returns {Promise<void>} Resolves once all filters are registered.
   */
  public register(): Promise<void> {
    this.registering ??= this.discoverFilters().catch((error: unknown) => {
      this.registering = undefined;
      throw error;
    });

    return this.registering;
  }

  /**
   * Returns whether a registered filter exists for the given error.
   *
   * @param {unknown} error The value thrown during request processing.
   * @returns {boolean} `true` when `error` is an `Error` instance **and** at
   * least one filter is registered for its class or one of its parent
   * classes, `false` otherwise.
   */
  public canHandle(error: unknown): boolean {
    return error instanceof Error && this.findFilters(error) !== undefined;
  }

  /**
   * Dispatches `error` to the exception filters of its most specific class
   * that has filters and collects their return values.
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
        (this.findFilters(error) ?? []).map((
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
   * Finds the filters of the error's class or, when it has none, of the
   * closest parent class that has some.
   *
   * @param {Error} error The error to find the filters for.
   * @returns {ExceptionFilterEntry[]|undefined} The filters sorted by
   * priority, or `undefined` when no class in the chain has any.
   *
   * @internal
   */
  private findFilters(error: Error): ExceptionFilterEntry[] | undefined {
    for (
      let target: unknown = error.constructor;
      typeof target === "function";
      target = Object.getPrototypeOf(target)
    ) {
      const entries = this.handlers.get(target as Type);

      if (entries) {
        return entries;
      }
    }

    return undefined;
  }

  /**
   * Resolves every `EXCEPTION_FILTER`-tagged provider into a new cache, which
   * replaces the current one once all filters are resolved.
   *
   * @returns {Promise<void>} Resolves once the cache is replaced.
   *
   * @internal
   */
  private async discoverFilters(): Promise<void> {
    const handlers = new WeakMap<Type, ExceptionFilterEntry[]>();

    for (
      const token of this.ctx.container.getTokensByTag(EXCEPTION_FILTER, true)
    ) {
      await this.registerExceptionHandler(
        handlers,
        token as Type<ExceptionFilter>,
      );
    }

    this.handlers = handlers;
  }

  /**
   * Resolves the filter class from the DI container and adds it to `handlers`
   * if it carries valid {@linkcode ExceptionFilterMetadata}.
   *
   * @param {WeakMap<Type, ExceptionFilterEntry[]>} handlers The cache to add the filter to.
   * @param {Type<ExceptionFilter>} filterClass The class decorated with `@Catch`.
   * @returns {Promise<void>}
   *
   * @internal
   */
  private async registerExceptionHandler(
    handlers: WeakMap<Type, ExceptionFilterEntry[]>,
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
      this.getExceptionFilterEntries(handlers, metadata.target),
      {
        exceptionFilter,
        priority: metadata.priority ?? 0,
      },
    );
  }

  /**
   * Retrieves (or lazily creates) the filter entry list for `target`.
   *
   * @param {WeakMap<Type, ExceptionFilterEntry[]>} handlers The cache holding the lists.
   * @param {Type} target The exception class used as the cache key.
   * @returns {ExceptionFilterEntry[]} The mutable entry list for `target`.
   *
   * @internal
   */
  private getExceptionFilterEntries(
    handlers: WeakMap<Type, ExceptionFilterEntry[]>,
    target: Type,
  ): ExceptionFilterEntry[] {
    let entries = handlers.get(target);

    if (!entries) {
      entries = [];

      handlers.set(target, entries);
    }

    return entries;
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
