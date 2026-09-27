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
 * @example Using built-in pipes on query and path parameters
 * ```ts
 * import { Controller, Get, type RequestContext } from "@denorid/core";
 * import { ParseBoolPipe, ParseIntPipe } from "@denorid/core/pipes";
 *
 * @Controller("/items")
 * class ItemsController {
 *   // GET /items/42?page=2&active=true
 *   @Get("/:id")
 *   public getItems(ctx: RequestContext): unknown {
 *     const id = ctx.param("id", new ParseIntPipe());
 *     const page = ctx.query("page", new ParseIntPipe({ optional: true }));
 *     const active = ctx.query("active", new ParseBoolPipe());
 *
 *     return { id, page: page ?? 1, active };
 *   }
 * }
 * ```
 *
 * @example Using a custom exception factory
 * ```ts
 * import { UnprocessableContentException } from "@denorid/core";
 * import { ParseUuidPipe } from "@denorid/core/pipes";
 *
 * const pipe = new ParseUuidPipe({
 *   exceptionFactory: (msg) => new UnprocessableContentException(msg),
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
