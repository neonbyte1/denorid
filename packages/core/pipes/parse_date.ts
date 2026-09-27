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
 * ISO 8601 calendar date (`YYYY-MM-DD`) with an optional time
 * (`THH:mm`, `THH:mm:ss`, `THH:mm:ss.sss`) and an optional UTC designator or
 * offset (`Z`, `+HH:mm`, `-HH:mm`). Captures year, month and day.
 */
const ISO_8601_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/i;

/** Matches epoch milliseconds: an optional minus followed by digits. */
const EPOCH_MILLISECONDS_PATTERN = /^-?\d+$/;

/** Days per month (January first) in a common year. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Pipe that coerces a route argument to a `Date`.
 *
 * Accepted input:
 * - ISO 8601 strings: `YYYY-MM-DD`, optionally followed by a time
 *   (`THH:mm`, `THH:mm:ss` or `THH:mm:ss.sss`) and `Z` or a `+HH:mm`/`-HH:mm`
 *   offset. Date-only values are UTC midnight, date-times without offset use
 *   local time (like `Date`). Impossible dates such as `2024-02-30` are
 *   rejected instead of rolling over.
 * - Epoch milliseconds, as a number (`0` is the epoch) or a digit-only
 *   string (`"1705276800000"`), so timestamps work in query strings.
 *
 * Everything else (e.g. `"not-a-date"`, `"foo 2"`, `"Jan 5 2024"`) triggers
 * the exception factory, as do `null`, `undefined` and `""` unless the pipe
 * is optional.
 * When `options.optional` is `true`, nil values return the result of
 * `options.default()` if provided, otherwise the nil value itself.
 *
 * @example
 * ```ts
 * const pipe = new ParseDatePipe();
 * pipe.transform("2024-01-15");           // 2024-01-15T00:00:00.000Z
 * pipe.transform("2024-01-15T10:00:00Z"); // 2024-01-15T10:00:00.000Z
 * pipe.transform(1705276800000);          // Date object (from timestamp)
 * pipe.transform("1705276800000");        // Date object (from timestamp)
 * pipe.transform("2024-02-30");           // throws BadRequestException
 * pipe.transform("not-a-date");           // throws BadRequestException
 * ```
 */
export class ParseDatePipe extends BaseParsePipe<
  Date | null | undefined,
  string | number | undefined | null,
  ParseDatePipeOptions
> {
  /**
   * @param {ParseDatePipeOptions} [options] Configuration options for this pipe instance.
   */
  public constructor(options?: ParseDatePipeOptions) {
    super(options);
  }

  /**
   * @param {string | number | null | undefined} value The raw route argument value.
   * @returns {Date | null | undefined} The parsed `Date`, or `null` / `undefined` when optional.
   * @throws When no value is provided or the value is not a valid ISO 8601 date or epoch timestamp.
   */
  public override transform(
    value: string | number | null | undefined,
  ): Date | null | undefined {
    if (this.options?.optional && isNil(value)) {
      return this.options.default?.() ?? value;
    }

    if (isNil(value) || value === "") {
      throw this.exceptionFactory("Validation failed (no Date provided)");
    }

    const date = this.toDate(value)!;

    if (isNaN(date.getTime())) {
      throw this.exceptionFactory("Validation failed (invalid date format)");
    }

    return date;
  }

  /**
   * Converts a raw value to a `Date` instance. Strings that are neither
   * ISO 8601 nor epoch milliseconds, and ISO dates that do not exist, yield
   * an invalid `Date` (`getTime()` is `NaN`).
   *
   * @param {string | number | Date | null | undefined} value The value to convert.
   * @returns {Date | null | undefined} A `Date` instance, or the nil value unchanged.
   */
  protected toDate(
    value: string | number | Date | null | undefined,
  ): Date | null | undefined {
    if (isNil(value) || value instanceof Date) {
      return value;
    }

    if (typeof value === "number") {
      return new Date(value);
    }

    if (EPOCH_MILLISECONDS_PATTERN.test(value)) {
      return new Date(Number(value));
    }

    const match = ISO_8601_PATTERN.exec(value);

    if (!match) {
      return new Date(NaN);
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = month === 2 && isLeapYear
      ? 29
      : DAYS_IN_MONTH[month - 1];

    // `daysInMonth` is `undefined` for months outside 1-12.
    return day >= 1 && day <= daysInMonth ? new Date(value) : new Date(NaN);
  }
}
