import { BaseParsePipe } from "./base.ts";

/**
 * Pipe that coerces a route argument to a `boolean`.
 *
 * Accepts the boolean literals `true` / `false` as well as the strings
 * `"true"` / `"false"`. Any other value throws a validation exception.
 * When `options.optional` is `true`, `null` and `undefined` are passed
 * through unchanged.
 *
 * @example
 * ```ts
 * const pipe = new ParseBoolPipe();
 * pipe.transform("true");  // true
 * pipe.transform(false);   // false
 * pipe.transform("yes");   // throws BadRequestException
 * ```
 */
export class ParseBoolPipe extends BaseParsePipe<boolean, string | boolean> {
  /**
   * @param {string | boolean} value The raw route argument value.
   * @returns {boolean} The parsed boolean value.
   * @throws When the value cannot be interpreted as a boolean and the pipe is not optional.
   */
  public override transform(value: string | boolean): boolean {
    if ((value === null || value === undefined) && this.options?.optional) {
      return value;
    }
    if (this.isTrue(value)) {
      return true;
    }
    if (this.isFalse(value)) {
      return false;
    }

    throw this.exceptionFactory(
      "Validation failed (boolean string is expected)",
    );
  }

  /**
   * @param {string | boolean} value Currently processed route argument.
   * @returns {boolean} `true` if `value` is said 'true', ie., if it is equal to the boolean
   * `true` or the string `"true"`.
   */
  protected isTrue(value: string | boolean): boolean {
    return value === true || value === "true";
  }

  /**
   * @param {string | boolean} value Currently processed route argument.
   * @returns {boolean} `true` if `value` is said 'false', ie., if it is equal to the boolean
   * `false` or the string `"false"`.
   */
  protected isFalse(value: string | boolean): boolean {
    return value === false || value === "false";
  }
}
