import type { ZodError } from "zod";
import { BadRequestException } from "./bad_request.ts";
import type { HttpExceptionOptions } from "./base.ts";

/**
 * Specialization of {@linkcode BadRequestException} for Zod schema validation failures.
 *
 * Maps every issue of a {@linkcode ZodError} to one entry of the `message`
 * array in the 400 Bad Request response body. Issues with a path are
 * prefixed with it (`"address.zip: Invalid input"`), so clients can tell
 * which field failed.
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
    super(
      error.issues.map((issue) =>
        issue.path.length > 0
          ? `${issue.path.map(String).join(".")}: ${issue.message}`
          : issue.message
      ),
      descriptionOrOptions,
    );
  }
}
