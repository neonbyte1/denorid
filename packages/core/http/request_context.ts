import type { z, ZodType } from "zod";
import type {
  ArgumentMetadata,
  PipeTransform,
  PipeTransformFn,
} from "../pipes/pipe_transform.ts";
import { isFunction } from "../type_guards.ts";

/**
 * Infers the TypeScript type from a Zod schema, or passes `T` through unchanged
 * when it is not a Zod schema.
 *
 * @template T - A Zod schema type or any other type.
 */
export type InferIfZod<T> = T extends ZodType ? z.infer<T> : T;

/**
 * Abstract base class providing access to the incoming HTTP request data.
 *
 * Concrete implementations are provided by the adapter layer (e.g. Hono) and
 * are injected into route handlers by the framework. The optional `Dto` type
 * parameter describes the validated/parsed request body; when a Zod schema is
 * supplied the inferred type is used automatically via {@link InferIfZod}.
 *
 * @template Dto - The type or Zod schema describing the request body.
 */
export abstract class RequestContext<Dto = unknown> {
  public constructor(public readonly dto: InferIfZod<Dto> | undefined) {}

  /**
   * Returns all request headers as a key/value map.
   *
   * @return {Record<string, string>} All headers present on the request.
   */
  public abstract headers(): Record<string, string>;

  /**
   * Returns the value of a single request header.
   *
   * @param {string} key - The header name (case-insensitive).
   * @return {string | undefined} The header value, or `undefined` if absent.
   */
  public abstract header(key: string): string | undefined;

  /**
   * Returns all route path parameters as a key/value map.
   *
   * @return {Record<string, string>} All path parameters extracted from the route.
   */
  public abstract params(): Record<string, string>;

  /**
   * Returns the raw string value of a single route path parameter.
   *
   * @param {string} key - The parameter name as defined in the route pattern.
   * @return {string | undefined} The parameter value, or `undefined` if absent.
   */
  public abstract param(key: string): string | undefined;
  /**
   * Returns the value of a single route path parameter, transformed via a pipe.
   *
   * @param {string} key - The parameter name as defined in the route pattern.
   * @param {PipeTransform<T> | PipeTransformFn<T>} transformer - Pipe used to convert the raw string value.
   * @return {T} The transformed parameter value.
   */
  public abstract param<T>(
    key: string,
    transformer: PipeTransform<T> | PipeTransformFn<T>,
  ): T;

  /**
   * Returns all query string parameters as a key/value-array map.
   *
   * @return {Record<string, string[]>} All query parameters, where each key may have multiple values.
   */
  public abstract queries(): Record<string, string[]>;

  /**
   * Returns all values for a specific query string parameter.
   *
   * @param {string} key - The query parameter name.
   * @return {string[]} All raw string values for the given key.
   */
  public abstract queries(key: string): string[];

  /**
   * Returns all values for a specific query string parameter, transformed by the given pipe.
   *
   * @param {string} key - The query parameter name.
   * @param {PipeTransform<T> | PipeTransformFn<T>} transformer - Pipe used to transform each value.
   * @return {T[]} All transformed values for the given key.
   */
  public abstract queries<T>(
    key: string,
    transformer: PipeTransform<T> | PipeTransformFn<T>,
  ): T[];

  /**
   * Returns the raw string value of a single query string parameter.
   *
   * @param {string} key - The query parameter name.
   * @return {string | undefined} The first value for the key, or `undefined` if absent.
   */
  public abstract query(key: string): string | undefined;
  /**
   * Returns the value of a single query string parameter, transformed via a pipe.
   *
   * @param {string} key - The query parameter name.
   * @param {PipeTransform<T> | PipeTransformFn<T>} transformer - Pipe used to convert the raw string value.
   * @return {T} The transformed query value.
   */
  public abstract query<T>(
    key: string,
    transformer: PipeTransform<T> | PipeTransformFn<T>,
  ): T;

  /**
   * Applies a pipe transformer to a raw string value.
   *
   * @param {string | null | undefined} value - The raw value to transform.
   * @param {PipeTransform<T> | PipeTransformFn<T>} transformer - The pipe to apply.
   * @param {ArgumentMetadata} metadata - Metadata describing the argument being transformed.
   * @return {T} The result produced by the transformer.
   */
  protected transform<T>(
    value: string | null | undefined,
    transformer: PipeTransform<T> | PipeTransformFn<T>,
    metadata: ArgumentMetadata,
  ): T {
    return isFunction<PipeTransformFn<T>>(transformer)
      ? transformer(value!, metadata)
      : transformer.transform(value!, metadata);
  }
}
