import type { Type } from "@denorid/injector";

/**
 * Metadata describing the route argument that a pipe is currently processing.
 */
export interface ArgumentMetadata {
  /** Whether the argument originates from a query string or a path parameter. */
  readonly type: "query" | "param";
  /** The metatype (constructor) of the expected value, if available. */
  readonly metatype?: Type;
  /** The name of the argument (e.g. the query key or param segment name). */
  readonly data?: string;
}

/**
 * Contract for class-based pipes that transform a route argument value.
 *
 * @typeParam R - The type produced after transformation.
 * @typeParam T - The raw input type; defaults to `string`.
 *
 * @example
 * ```ts
 * class MyPipe implements PipeTransform<number> {
 *   transform(value: string): number {
 *     return parseInt(value, 10);
 *   }
 * }
 * ```
 */
export interface PipeTransform<R, T = string> {
  /**
   * Transforms the raw route argument value.
   *
   * @param {T} value The raw value received from the route.
   * @param {ArgumentMetadata} metadata Metadata about the argument being processed.
   * @returns {R} The transformed value.
   */
  transform(value: T, metadata: ArgumentMetadata): R;
}

/**
 * Functional alternative to {@linkcode PipeTransform} for lightweight pipes.
 *
 * @typeParam R - The type produced after transformation.
 * @typeParam T - The raw input type; defaults to `string`.
 */
export type PipeTransformFn<R, T = string> = (
  value: T,
  metadata: ArgumentMetadata,
) => R;
