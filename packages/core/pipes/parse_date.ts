import { isNil } from "../type_guards.ts";
import { BaseParsePipe, type ParsePipeOptions } from "./base.ts";

/**
 * Options specific to {@linkcode ParseDatePipe}.
 */
export interface ParseDatePipeOptions extends ParsePipeOptions {
  /**
   * Factory returning the fallback `Date` used when the value is `null` or
   * `undefined` and `optional` is `true`. When omitted the raw nil value is
   * returned as-is.
   *
   * @returns {Date} The default date to use.
   */
  default?: () => Date;
}

/**
 * Pipe that coerces a route argument to a `Date`.
 *
 * Accepts string and numeric inputs that can be parsed by the `Date`
 * constructor. Invalid date strings (e.g. `"not-a-date"`) cause the resulting
 * `Date` to be `NaN` and will trigger the exception factory.
 * When `options.optional` is `true`, nil values return the result of
 * `options.default()` if provided, otherwise the nil value itself.
 *
 * @example
 * ```ts
 * const pipe = new ParseDatePipe({ optional: false });
 * pipe.transform("2024-01-15"); // Date object
 * pipe.transform(1705276800000); // Date object (from timestamp)
 * pipe.transform("not-a-date"); // throws BadRequestException
 * ```
 */
export class ParseDatePipe extends BaseParsePipe<
  Date | null | undefined,
  string | number | undefined | null,
  ParseDatePipeOptions
> {
  /**
   * @param {ParseDatePipeOptions} options Configuration options for this pipe instance.
   */
  public constructor(options: ParseDatePipeOptions) {
    super(options);
  }

  /**
   * @param {string | number | null | undefined} value The raw route argument value.
   * @returns {Date | null | undefined} The parsed `Date`, or `null` / `undefined` when optional.
   * @throws When no value is provided or the value cannot be parsed as a valid date.
   */
  public override transform(
    value: string | number | null | undefined,
  ): Date | null | undefined {
    if (this.options?.optional && isNil(value)) {
      return this.options.default?.() ?? value;
    }

    if (!value) {
      throw this.exceptionFactory("Validation failed (no Date provided)");
    }

    const date = this.toDate(value)!;

    if (isNaN(date.getTime())) {
      throw this.exceptionFactory("Validation failed (invalid date format)");
    }

    return date;
  }

  /**
   * Converts a raw value to a `Date` instance.
   *
   * @param {string | number | Date | null | undefined} value The value to convert.
   * @returns {Date | null | undefined} A `Date` instance, or the nil value unchanged.
   */
  protected toDate(
    value: string | number | Date | null | undefined,
  ): Date | null | undefined {
    return isNil(value)
      ? value
      : value instanceof Date
      ? value
      : new Date(value);
  }
}
