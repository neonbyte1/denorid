/**
 * Built-in pipes for transforming and validating route arguments (query parameters
 * and path segments) before they reach a controller handler.
 *
 * Each pipe implements {@linkcode PipeTransform} and can be used either as a
 * class instance or, for lightweight cases, replaced by a {@linkcode PipeTransformFn}
 * function. All built-in parse pipes extend {@linkcode BaseParsePipe} and share the
 * same {@linkcode ParsePipeOptions} (custom `exceptionFactory`, `statusCode`, `optional`).
 *
 * | Pipe              | Produces          |
 * |-------------------|-------------------|
 * | `ParseIntPipe`    | `number` (integer)|
 * | `ParseFloatPipe`  | `number` (float)  |
 * | `ParseBoolPipe`   | `boolean`         |
 * | `ParseDatePipe`   | `Date`            |
 * | `ParseEnumPipe`   | enum member       |
 * | `ParseUuidPipe`   | `string` (UUID)   |
 *
 * @example Using a built-in pipe on a query parameter
 * ```ts
 * import { ParseIntPipe, ParseBoolPipe } from "@denorid/core/pipes";
 *
 * // Inside a controller handler:
 * // GET /items?page=2&active=true
 * async getItems(
 *   @Query("page", new ParseIntPipe()) page: number,
 *   @Query("active", new ParseBoolPipe()) active: boolean,
 * ) { ... }
 * ```
 *
 * @example Using a custom exception factory
 * ```ts
 * import { ParseUuidPipe } from "@denorid/core/pipes";
 * import { UnprocessableEntityException } from "@denorid/core";
 *
 * const pipe = new ParseUuidPipe({
 *   exceptionFactory: (msg) => new UnprocessableEntityException(msg),
 * });
 * ```
 * @module
 */
export * from "./base.ts";
export * from "./parse_bool.ts";
export * from "./parse_date.ts";
export * from "./parse_enum.ts";
export * from "./parse_float.ts";
export * from "./parse_int.ts";
export * from "./parse_uuid.ts";
export * from "./pipe_transform.ts";
