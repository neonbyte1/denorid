import { isNil } from "../type_guards.ts";
import { ParseFloatPipe } from "./parse_float.ts";

/** Regex that matches optional leading minus followed by one or more digits. */
const INTEGER_PATTERN = /^-?\d+$/;

/**
 * Pipe that coerces a route argument to an integer `number`.
 *
 * Extends {@linkcode ParseFloatPipe} but restricts string inputs to whole
 * integers — fractional strings such as `"1.5"` are rejected. Numeric values
 * that are not finite are also rejected.
 * When `options.optional` is `true`, `null` and `undefined` are passed
 * through unchanged.
 *
 * @example
 * ```ts
 * const pipe = new ParseIntPipe();
 * pipe.transform("42");  // 42
 * pipe.transform("-7");  // -7
 * pipe.transform("1.5"); // throws BadRequestException
 * pipe.transform("abc"); // throws BadRequestException
 * ```
 */
export class ParseIntPipe extends ParseFloatPipe {
  /**
   * Converts the raw value to an integer, returning `undefined` for any
   * value that is nil, non-integer, or non-finite.
   *
   * @param {string | number | null | undefined} value The raw value to convert.
   * @returns {number | undefined} The integer value, or `undefined` on failure.
   */
  protected override extractNumericValue(
    value: string | number | null | undefined,
  ): number | undefined {
    if (isNil(value)) {
      return undefined;
    }

    if (typeof value === "string") {
      if (!INTEGER_PATTERN.test(value)) {
        return undefined;
      }

      value = parseInt(value, 10);
    }

    return isFinite(value) ? value : undefined;
  }
}
