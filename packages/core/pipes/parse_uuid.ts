import { v1, v3, v4, v5, v7 } from "@std/uuid";
import { isNil } from "../type_guards.ts";
import { BaseParsePipe, type ParsePipeOptions } from "./base.ts";

/**
 * Options specific to {@linkcode ParseUuidPipe}.
 */
export interface ParseUuidPipeOptions extends ParsePipeOptions {
  /**
   * When set, only UUIDs of the specified version are accepted.
   * Omitting this field accepts any valid UUID (v1, v3, v4, v5, or v7).
   */
  version?: 1 | 3 | 4 | 5 | 7 | "1" | "3" | "4" | "5" | "7";
}

/** Map from UUID version number to its corresponding validator function. */
const validateUuidVersion = {
  [1]: v1.validate,
  [3]: v3.validate,
  [4]: v4.validate,
  [5]: v5.validate,
  [7]: v7.validate,
};

/**
 * Pipe that validates a route argument as a UUID string.
 *
 * When `options.version` is set, only the specified UUID version is accepted.
 * Otherwise any valid UUID version (1, 3, 4, 5, or 7) is accepted.
 * When `options.optional` is `true`, `null` and `undefined` are passed
 * through unchanged.
 *
 * @example
 * ```ts
 * const pipe = new ParseUuidPipe({ version: 4 });
 * pipe.transform("f47ac10b-58cc-4372-a567-0e02b2c3d479"); // valid v4 uuid
 * pipe.transform("not-a-uuid"); // throws BadRequestException
 * ```
 */
export class ParseUuidPipe extends BaseParsePipe<
  string | null | undefined,
  string | null | undefined,
  ParseUuidPipeOptions
> {
  /**
   * @param {string | null | undefined} value The raw route argument value.
   * @returns {string | null | undefined} The validated UUID string, or `null` / `undefined` when optional.
   * @throws When the value is not a valid UUID (or not the expected version) and the pipe is not optional.
   */
  public override transform(
    value: string | null | undefined,
  ): string | null | undefined {
    if (isNil(value) && this.options?.optional) {
      return value;
    }

    if (!this.isValidUuid(value)) {
      throw this.exceptionFactory(
        `Validation failed (uuid${
          this.options?.version ? ` v${this.options.version}` : ""
        } is expected).`,
      );
    }

    return value;
  }

  /**
   * Checks whether `value` is a valid UUID, optionally restricted to a
   * specific version.
   *
   * @param {string | null | undefined} value The value to validate.
   * @returns {boolean} `true` when the value is a valid (version-matched) UUID.
   */
  protected isValidUuid(value: string | null | undefined): boolean {
    return !isNil(value) && this.options?.version
      ? validateUuidVersion[this.options.version](value)
      : Object.values(validateUuidVersion).some((fn) => fn(value!));
  }
}
