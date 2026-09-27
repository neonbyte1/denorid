import type { MethodDecorator } from "@denorid/injector";
import type { ZodType } from "zod";
import {
  createRequestMappingDecorator,
  type RequestMappingValidationMetadata,
} from "./_request_mapping.ts";

type RequestValidationDecoratorFactory = (dto: ZodType) => MethodDecorator;

function createRequestValidationDecorator(
  type: RequestMappingValidationMetadata["type"],
): RequestValidationDecoratorFactory {
  return (dto: ZodType): MethodDecorator => {
    return createRequestMappingDecorator({
      name: type === "json" ? "Body" : "Form",
      initializer: (entry): void => {
        entry.validation = { type, dto };
      },
    });
  };
}

/**
 * Decorator that parses the request body as JSON and validates it against a
 * Zod schema before the route handler runs. A failed validation answers
 * `400 Bad Request`, a body that is no valid JSON as well. The parsed value is
 * read with `ctx.validated(dto)` or `ctx.dto`.
 *
 * @param {ZodType} dto - The Zod schema the parsed JSON body is validated against.
 * @return {MethodDecorator} A method decorator that registers JSON body validation for the route.
 */
export const Body: RequestValidationDecoratorFactory =
  createRequestValidationDecorator("json");

/**
 * Decorator that parses the request body as form data and validates it
 * against a Zod schema before the route handler runs. A failed validation
 * answers `400 Bad Request`, a body that cannot be parsed as well. The parsed
 * value is read with `ctx.validated(dto)` or `ctx.dto`.
 *
 * @param {ZodType} dto - The Zod schema the parsed form data is validated against.
 * @return {MethodDecorator} A method decorator that registers form data validation for the route.
 */
export const Form: RequestValidationDecoratorFactory =
  createRequestValidationDecorator("form");

/**
 * Decorator that validates the query string against a Zod schema before the
 * route handler runs. A failed validation answers `400 Bad Request`; the
 * parsed value is read with `ctx.validated(schema)`.
 *
 * The schema receives every query key once: a key given one time as a
 * string, a repeated key as a `string[]`, so a repeated key whose schema
 * expects a single value fails the validation. A key whose schema accepts an
 * array (`z.array()`, optionally wrapped in `.optional()`, `.default()`, ...)
 * is always a `string[]`, even when it is given once. Use `z.coerce` for
 * numbers, booleans and dates.
 *
 * @example
 * ```ts
 * const ListQuery = z.object({
 *   limit: z.coerce.number().int().max(100).default(20),
 *   tags: z.array(z.string()).optional(),
 * });
 *
 * \@Controller("/threads")
 * class ThreadController {
 *   \@Get()
 *   \@Query(ListQuery)
 *   public list(ctx: RequestContext): unknown {
 *     const { limit, tags } = ctx.validated(ListQuery);
 *     return { limit, tags };
 *   }
 * }
 * ```
 *
 * @param {ZodType} schema - The Zod schema the query string is validated against.
 * @return {MethodDecorator} A method decorator that registers query validation for the route.
 */
export function Query(schema: ZodType): MethodDecorator {
  return createRequestMappingDecorator({
    name: "Query",
    initializer: (entry): void => {
      entry.query = schema;
    },
  });
}

/**
 * Decorator that validates the path parameters against a Zod schema before
 * the route handler runs. A failed validation answers `400 Bad Request`; the
 * parsed value is read with `ctx.validated(schema)`. Every parameter is a
 * string: use `z.coerce` for numbers.
 *
 * @example
 * ```ts
 * const ThreadParams = z.object({ id: z.uuid() });
 *
 * \@Controller("/threads")
 * class ThreadController {
 *   \@Get("/:id")
 *   \@Params(ThreadParams)
 *   public get(ctx: RequestContext): unknown {
 *     return { id: ctx.validated(ThreadParams).id };
 *   }
 * }
 * ```
 *
 * @param {ZodType} schema - The Zod schema the path parameters are validated against.
 * @return {MethodDecorator} A method decorator that registers path parameter validation for the route.
 */
export function Params(schema: ZodType): MethodDecorator {
  return createRequestMappingDecorator({
    name: "Params",
    initializer: (entry): void => {
      entry.params = schema;
    },
  });
}
