import { HttpErrorByCode } from "../exceptions/http/mapping.ts";
import { type ErrorHttpStatusCode, StatusCode } from "../http/status.ts";
import type { ArgumentMetadata, PipeTransform } from "./pipe_transform.ts";

/**
 * Shared options accepted by all built-in parse pipes.
 */
export interface ParsePipeOptions {
  /**
   * HTTP status code used when the validation factory is auto-generated.
   * Defaults to `400 Bad Request`.
   */
  statusCode?: StatusCode;
  /**
   * When `true`, `null` and `undefined` values are passed through without
   * triggering a validation error.
   */
  optional?: boolean;
  /**
   * Custom factory for the exception thrown on validation failure.
   * Receives the error message string and must return an `Error` instance.
   *
   * @param {string} error Human-readable description of the validation failure.
   * @returns {Error} The error to throw.
   */
  exceptionFactory?: (error: string) => Error;
}

/**
 * Abstract base class shared by all built-in parse pipes.
 *
 * Subclasses must implement {@linkcode transform} and may call
 * `this.exceptionFactory` to produce a consistently configured error.
 *
 * @typeParam R - Type produced after a successful transformation.
 * @typeParam T - Raw input type accepted by `transform`.
 * @typeParam O - Options object type; must extend {@linkcode ParsePipeOptions}.
 */
export abstract class BaseParsePipe<
  R,
  T,
  O extends ParsePipeOptions = ParsePipeOptions,
> implements PipeTransform<R, T> {
  /**
   * Factory function used to create exceptions on validation failure.
   * Defaults to producing an HTTP exception matching `options.statusCode`
   * (or `400 Bad Request` when no status code is supplied).
   */
  protected exceptionFactory: Required<ParsePipeOptions>["exceptionFactory"];

  /**
   * @param {O} [options] Configuration options for this pipe instance.
   */
  public constructor(protected readonly options?: O) {
    const { exceptionFactory, statusCode = StatusCode.BadRequest } = options ??
      {};

    this.exceptionFactory = exceptionFactory ??
      ((error: string) =>
        new HttpErrorByCode[statusCode as ErrorHttpStatusCode](error));
  }

  /**
   * Transforms the raw route argument value into the expected type.
   *
   * @param {T} value The raw value to transform.
   * @param {ArgumentMetadata} metadata Metadata about the argument being transformed.
   * @returns {R} The transformed value.
   */
  public abstract transform(value: T, metadata: ArgumentMetadata): R;
}
