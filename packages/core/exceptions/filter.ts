import { type Decorator, Injectable, Tags, type Type } from "@denorid/injector";
import { EXCEPTION_FILTER, EXCEPTION_FILTER_METADATA } from "../_constants.ts";
import type { HostArguments } from "../host_arguments.ts";

/**
 * Interface describing implementation of an exception filter.
 */
export interface ExceptionFilter<T = unknown> {
  /**
   * Method to implement a custom exception filter.
   *
   * @template {unknown} T The target exception or error class
   *
   * @param {T} exception The class of the exception being handled
   * @param {HostArguments} host Used to access the in-flight host arguments
   *
   * @returns {unknown} A custom exception filter _may_ return something, but
   * there is no guarantee for it.
   */
  catch(exception: T, host: HostArguments): unknown;
}

/**
 * Metadata associated with an exception filter, used to configure which
 * exception class it targets and its resolution priority.
 *
 * @template T The exception class this filter is bound to
 */
export interface ExceptionFilterMetadata<T extends Error> {
  /** The exception class this filter handles. */
  target: Type;
  /**
   * Optional priority used to determine the order in which filters are
   * evaluated when multiple filters match the same exception. Higher values
   * take precedence.
   */
  priority?: number;
}

/**
 * Class decorator that marks a class as an exception filter and registers it
 * for a specific exception type.
 *
 * @template T The exception class to catch
 *
 * @param {Type<T>} exceptionClassToFilter The exception class this filter handles
 *
 * @example
 * ```ts
 * @Catch(HttpException)
 * class HttpExceptionFilter implements ExceptionFilter<HttpException> {
 *   catch(exception: HttpException, host: HostArguments): void { ... }
 * }
 * ```
 */
export function Catch<T extends Error>(
  exceptionClassToFilter: Type<T>,
): Decorator<ClassDecoratorContext, Type>;
/**
 * Class decorator that marks a class as an exception filter and registers it
 * for a specific exception type with additional options.
 *
 * @template T The exception class to catch
 *
 * @param {Type<T>} exceptionClassToFilter The exception class this filter handles
 * @param {Required<Omit<ExceptionFilterMetadata<T>, "target">>} options Additional filter options (e.g. priority)
 */
export function Catch<T extends Error>(
  exceptionClassToFilter: Type<T>,
  options: Required<Omit<ExceptionFilterMetadata<T>, "target">>,
): Decorator<ClassDecoratorContext, Type>;
/**
 * Class decorator that marks a class as an exception filter using a full
 * metadata object.
 *
 * @template T The exception class to catch
 *
 * @param {ExceptionFilterMetadata<T>} options Full metadata object describing the filter target and options
 */
export function Catch<T extends Error>(
  options: ExceptionFilterMetadata<T>,
): Decorator<ClassDecoratorContext, Type>;
export function Catch<T extends Error>(
  arg0: Type<T> | ExceptionFilterMetadata<T>,
  arg1?: Required<Omit<ExceptionFilterMetadata<T>, "target">>,
): Decorator<ClassDecoratorContext, Type> {
  return (target: Type, ctx: ClassDecoratorContext): void => {
    const options: ExceptionFilterMetadata<T> = typeof arg0 === "function"
      ? { target: arg0, ...(arg1 ?? {}) }
      : arg0;

    ctx.metadata[EXCEPTION_FILTER_METADATA] = options;

    Injectable()(target, ctx);
    Tags(EXCEPTION_FILTER)(target, ctx);
  };
}
