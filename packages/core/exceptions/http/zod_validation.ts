import type { ZodError } from "zod";
import { BadRequestException } from "./bad_request.ts";
import type { HttpExceptionOptions } from "./base.ts";

/**
 * Specialization of {@linkcode BadRequestException} for Zod schema validation failures.
 *
 * Extracts all issue messages from a {@linkcode ZodError} and forwards them as the
 * `message` array in the 400 Bad Request response body.
 *
 * @example
 * ```ts
 * const result = schema.safeParse(input);
 * if (!result.success) {
 *   throw new ZodValidationException(result.error);
 * }
 * ```
 */
export class ZodValidationException extends BadRequestException {
  /**
   * @param {ZodError} error - The Zod validation error whose issues will be mapped to messages.
   * @param {string | HttpExceptionOptions} [descriptionOrOptions] - Either a short description of
   *   the HTTP error or an {@linkcode HttpExceptionOptions} object used to provide an underlying error cause.
   */
  public constructor(
    error: ZodError,
    descriptionOrOptions?: string | HttpExceptionOptions,
  ) {
    super(error.issues.map((issue) => issue.message), descriptionOrOptions);
  }
}
