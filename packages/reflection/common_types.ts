// deno-lint-ignore-file no-explicit-any

/**
 * A generic constructor interface.
 *
 * Represents a class constructor that can accept any argument(s) and
 * produces an instance of type `T`
 *
 * @template T The instance type created by the constructor.
 */
export interface Constructor<T = any> extends Function {
  new (...args: any[]): T;
}

/**
 * A valid key type for metadata storage.
 *
 * Can be a string, number, or symbol — typically used in reflection utilities
 * for identifying metadata entries.
 */
export type MetadataKey = string | number | symbol;

/**
 * A target that metadata can be applied to.
 *
 * Represents either a class constructor or an object (e.g., a class prototype).
 */
export type Target = object | Constructor;

/**
 * Base class for all custom errors in the library.
 *
 * Extends the native `Error` class and captures the correct stack trace.
 */
export class CustomError extends Error {
  /**
   * Creates a new custom error.
   *
   * @param {string} message The error message.
   */
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

/**
 * Error thrown when an argument has an invalid type.
 *
 * Provides a clear message indicating the expected and received types.
 */
export class InvalidArgumentError extends CustomError {
  /**
   * Creates a new InvalidArgumentError.
   *
   * @example Usage
   * ```ts ignore
   * import { InvalidArgumentError } from "@denorid/reflection";
   *
   * function add(lhs: number, rhs: unknown): number {
   *   if (typeof rhs !== "number") {
   *     throw new InvalidArgumentError("rhs", "number", rhs);
   *   }
   *
   *   return lhs + rhs;
   * }
   * ```
   *
   * @param {string} argName The name of the argument.
   * @param {string | string[]} expectedType The expected type(s) for the argument.
   * @param {unknown} receivedValue The actual value received.
   */
  constructor(
    argName: string,
    expectedType: string | string[],
    receivedValue: unknown,
  ) {
    super(
      `Invalid type for argument "${argName}". Expected "${
        Array.isArray(expectedType) ? expectedType.join(" | ") : expectedType
      }", but received "${typeof receivedValue}".`,
    );
  }
}

/**
 * Error thrown when an argument is an empty array where a non-empty array is required.
 */
export class EmptyArrayArgumentError extends CustomError {
  /**
   * Creates a new EmptyArrayArgumentError.
   *
   * @example Usage
   * ```ts ignore
   * import { EmptyArrayArgumentError } from "@denorid/reflection";
   *
   * function add(base: number, values: number[]): number {
   *   if (values.length === 0) {
   *     throw new EmptyArrayArgumentError("values");
   *   }
   *
   *   return values.reduce((a, b) => a + b, base);
   * }
   * ```
   *
   * @param {string} argName The name of the argument.
   */
  constructor(argName: string) {
    super(`Argument "${argName}" must be a non-empty array.`);
  }
}
