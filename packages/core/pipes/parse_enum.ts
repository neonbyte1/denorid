import { isNil } from "../type_guards.ts";
import { BaseParsePipe, type ParsePipeOptions } from "./base.ts";

/**
 * Pipe that validates a route argument against a TypeScript enum.
 *
 * The pipe accepts both string and numeric enum members. When the incoming
 * value matches a numeric enum member as a numeric string it is coerced to the
 * corresponding number before being returned. Unrecognised values throw a
 * validation exception.
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
        `"ParseEnumPipe requries "enumType" argument specified (to validate input values).`,
      );
    }

    super(options);
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
        "Validation failed (enum number or enum string is expected.",
      );
    }

    return val;
  }

  /**
   * Looks up `value` in the enum's values, performing a numeric coercion
   * when a direct string match is not found.
   *
   * @param {unknown} value The raw value to look up.
   * @returns {T | undefined} The matched enum member, or `undefined` when not found.
   */
  protected parseEnumValue(value: unknown): T | undefined {
    const enumValues = Object.keys(this.enumType as object).map((item) =>
      (this.enumType as Record<string | number, unknown>)[item]
    );

    if (enumValues.includes(value)) {
      return value as T;
    }

    const parsedValue = Number(value);

    if (!isNaN(parsedValue) && enumValues.includes(parsedValue)) {
      return parsedValue as T;
    }

    return undefined;
  }
}
