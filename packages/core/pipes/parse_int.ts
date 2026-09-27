import { ParseFloatPipe } from "./parse_float.ts";

/** Regex that matches optional leading minus followed by one or more digits. */
const INTEGER_PATTERN = /^-?\d+$/;

/**
 * Pipe that coerces a route argument to an integer `number`.
 *
 * Extends {@linkcode ParseFloatPipe} but only accepts whole integers: strings
 * must consist of an optional minus and digits (`"1.5"`, `"1e3"` and `"12abc"`
 * are rejected), and numbers must be integers (`1.5` is rejected). Values
 * outside the safe integer range (`Number.MAX_SAFE_INTEGER`) are rejected
 * instead of being silently rounded.
 * When `options.optional` is `true`, `null` and `undefined` are passed
 * through unchanged.
 *
 * @example
 * ```ts
 * const pipe = new ParseIntPipe();
 * pipe.transform("42");  // 42
 * pipe.transform("-7");  // -7
 * pipe.transform("1.5"); // throws BadRequestException
 * pipe.transform(1.5);   // throws BadRequestException
 * pipe.transform("abc"); // throws BadRequestException
 * ```
 */
export class ParseIntPipe extends ParseFloatPipe {
  /**
   * Converts the raw value to an integer, returning `undefined` for any
   * value that is nil, not an integer, or outside the safe integer range.
   *
   * @param {string | number | null | undefined} value The raw value to convert.
   * @returns {number | undefined} The integer value, or `undefined` on failure.
   */
  protected override extractNumericValue(
    value: string | number | null | undefined,
  ): number | undefined {
    if (typeof value === "string") {
      if (!INTEGER_PATTERN.test(value)) {
        return undefined;
      }

      value = Number(value);
    }

    return Number.isSafeInteger(value) ? value as number : undefined;
  }
}
