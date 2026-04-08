import { isNil } from "../type_guards.ts";
import { BaseParsePipe } from "./base.ts";

/**
 * Pipe that coerces a route argument to a floating-point `number`.
 *
 * String values are parsed with `parseFloat`. `NaN` and non-finite results
 * are treated as invalid and trigger the exception factory.
 * When `options.optional` is `true`, `null` and `undefined` are passed
 * through unchanged.
 *
 * @example
 * ```ts
 * const pipe = new ParseFloatPipe();
 * pipe.transform("3.14"); // 3.14
 * pipe.transform(42);     // 42
 * pipe.transform("abc");  // throws BadRequestException
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
   * value that is nil, `NaN`, or non-finite.
   *
   * @param {string | number | null | undefined} value The raw value to convert.
   * @returns {number | undefined} The numeric value, or `undefined` on failure.
   */
  protected extractNumericValue(
    value: string | number | null | undefined,
  ): number | undefined {
    if (isNil(value)) {
      return undefined;
    }

    if (typeof value === "string") {
      value = parseFloat(value);
    }

    return !isNaN(value) && isFinite(value) ? value : undefined;
  }
}
