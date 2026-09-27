import { isNil } from "../type_guards.ts";
import { BaseParsePipe } from "./base.ts";

/**
 * Matches a complete decimal number: optional minus, digits with an optional
 * fraction (`1`, `1.5`, `.5`, `5.`) and an optional exponent (`1e3`).
 */
const DECIMAL_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Pipe that coerces a route argument to a floating-point `number`.
 *
 * Strings must be a complete decimal number (`"3.14"`, `"-1"`, `".5"`,
 * `"1e3"`). Anything else is rejected, including trailing garbage
 * (`"12abc"`), decimal commas (`"1,5"`), hex (`"0x10"`), surrounding
 * whitespace and empty strings. Non-finite results (`NaN`, `"1e400"`) are
 * rejected too.
 * When `options.optional` is `true`, `null` and `undefined` are passed
 * through unchanged.
 *
 * @example
 * ```ts
 * const pipe = new ParseFloatPipe();
 * pipe.transform("3.14");  // 3.14
 * pipe.transform(42);      // 42
 * pipe.transform("abc");   // throws BadRequestException
 * pipe.transform("12abc"); // throws BadRequestException
 * ```
 */
export class ParseFloatPipe extends BaseParsePipe<
  number | null | undefined,
  string | number | null | undefined
> {
  /**
   * @param {string | number | null | undefined} value The raw route argument value.
   * @returns {number | null | undefined} The parsed float, or `null` / `undefined` when optional.
   * @throws When the value is not a valid finite number and the pipe is not optional.
   */
  public override transform(
    value: string | number | null | undefined,
  ): number | null | undefined {
    if (isNil(value) && this.options?.optional) {
      return value;
    }

    const val = this.extractNumericValue(value);

    if (val === undefined) {
      throw this.exceptionFactory(
        "Validation failed (numeric string is expected).",
      );
    }

    return val;
  }

  /**
   * Converts the raw value to a `number`, returning `undefined` for any
   * value that is nil, not a complete decimal number string, `NaN`, or
   * non-finite.
   *
   * @param {string | number | null | undefined} value The raw value to convert.
   * @returns {number | undefined} The numeric value, or `undefined` on failure.
   */
  protected extractNumericValue(
    value: string | number | null | undefined,
  ): number | undefined {
    if (typeof value === "string") {
      if (!DECIMAL_PATTERN.test(value)) {
        return undefined;
      }

      value = Number(value);
    }

    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }
}
