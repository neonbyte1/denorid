/**
 * Checks wether the given value is `null` or `undefined`.
 *
 * @param {unknown} value The value to test.
 * @returns {boolean} `true` when the `value` is `null` or `undefined`, `false` otherwise.
 *
 * @example
 * ```ts
 * isNil(null);      // true
 * isNil(undefined); // true
 * isNil(0);         // false
 * isNil("");        // false
 * ```
 */
export function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Checks wether the type of the given value is `string`.
 *
 * @typeParam T - String sub-type to narrow to; defaults to `string`.
 * @param {unknown} value The value to test.
 * @returns {boolean} `true` when the type of `value` is `"string"`, `false` otherwise.
 *
 * @example
 * ```ts
 * isString("hello"); // true
 * isString(42);      // false
 * isString(null);    // false
 * ```
 */
export function isString<T extends string = string>(
  value: unknown,
): value is T {
  return typeof value === "string";
}

/**
 * Checks wether the type of the given value is `function`.
 *
 * @typeParam T - Function sub-type to narrow to.
 * @param {unknown} value The value to test.
 * @returns {boolean} `true` when the type of `value` is `"function"`, `false` otherwise.
 *
 * @example
 * ```ts
 * isFunction(() => {}); // true
 * isFunction("foo");    // false
 * isFunction(null);     // false
 * ```
 */
// deno-lint-ignore ban-types
export function isFunction<T extends Function>(value: unknown): value is T {
  return typeof value === "function";
}
