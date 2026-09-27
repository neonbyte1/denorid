import { isNil } from "../type_guards.ts";
import { BaseParsePipe, type ParsePipeOptions } from "./base.ts";

/** Matches a plain decimal number string (`"1"`, `"-2"`, `"1.5"`). */
const NUMERIC_PATTERN = /^-?\d+(?:\.\d+)?$/;

/**
 * Pipe that validates a route argument against a TypeScript enum.
 *
 * The pipe accepts the values of string and numeric enum members. A plain
 * decimal string (`"1"`, `"-2"`, `"1.5"`) that equals a numeric member is
 * coerced to that number. Member names (`"Red"` for `enum Color { Red = 0 }`),
 * empty or padded strings, hex or exponent notation and nil values are
 * rejected with a validation exception.
 * When `options.optional` is `true`, `null` and `undefined` are passed
 * through unchanged.
 *
 * @typeParam T - The enum type to validate against.
 *
 * @example
 * ```ts
 * enum Direction { Up = "UP", Down = "DOWN" }
 * const pipe = new ParseEnumPipe<Direction>(Direction);
 * pipe.transform("UP");   // Direction.Up
 * pipe.transform("LEFT"); // throws BadRequestException
 * ```
 */
export class ParseEnumPipe<T> extends BaseParsePipe<T, string> {
  /** Member values of the enum, without the reverse mappings of numeric members. */
  private readonly enumValues: ReadonlySet<unknown>;

  /**
   * @param {object} enumType The enum object to validate values against.
   * @param {ParsePipeOptions} [options] Configuration options for this pipe instance.
   * @throws {Error} When `enumType` is falsy.
   */
  public constructor(
    protected readonly enumType: object,
    options?: ParsePipeOptions,
  ) {
    if (!enumType) {
      throw new Error(
        `"ParseEnumPipe" requires the "enumType" argument (to validate input values).`,
      );
    }

    super(options);

    const members = enumType as Record<string, unknown>;

    // A numeric member `Red = 0` also creates the reverse mapping `"0": "Red"`.
    this.enumValues = new Set(
      Object.keys(members)
        .filter((key) => {
          const value = members[key];

          return !(typeof value === "string" && members[value] === Number(key));
        })
        .map((key) => members[key]),
    );
  }

  /**
   * @param {string} value The raw route argument value.
   * @returns {T} The matched enum member.
   * @throws When the value does not match any enum member and the pipe is not optional.
   */
  public override transform(value: string): T {
    if (isNil(value) && this.options?.optional) {
      return value;
    }

    const val = this.parseEnumValue(value);

    if (val === undefined) {
      throw this.exceptionFactory(
        "Validation failed (enum number or enum string is expected).",
      );
    }

    return val;
  }

  /**
   * Looks up `value` in the enum's member values. A plain decimal string is
   * coerced to a number when it does not match a member directly.
   *
   * @param {unknown} value The raw value to look up.
   * @returns {T | undefined} The matched enum member, or `undefined` when not found.
   */
  protected parseEnumValue(value: unknown): T | undefined {
    if (this.enumValues.has(value)) {
      return value as T;
    }

    if (typeof value === "string" && NUMERIC_PATTERN.test(value)) {
      const parsedValue = Number(value);

      if (this.enumValues.has(parsedValue)) {
        return parsedValue as T;
      }
    }

    return undefined;
  }
}
