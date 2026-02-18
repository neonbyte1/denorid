/**
 * Represents an abstract class type.
 *
 * Unlike {@link Type}, this does **not** guarantee the presence
 * of a `new` constructor signature.
 */
export interface Abstract<T> extends Function {
  prototype: T;
}

/**
 * Represents a concrete class constructor.
 *
 * It extends {@link Abstract} and guarantees a `new` signature.
 *
 * This is commonly used in dependency injection containers as a class-based
 * injection token or in class decorators.
 */
export interface Type<T = unknown> extends Abstract<T> {
  /**
   * Creates a new instances of type `T`.
   *
   * @param {any[]} args - Constructor arguments
   */
  // deno-lint-ignore no-explicit-any
  new (...args: any[]): T;
}

/**
 * Represents a generic function type that lets you define its "shape".
 *
 * @template T - The return type of the function
 * @template Args - The type of each argument
 */
// deno-lint-ignore no-explicit-any
export type GenericFunction<T = unknown, Args = any> = (
  ...args: Args[]
) => T;

/**
 * Represents a dependency injection token.
 *
 * Supported token types:
 * - {@link Type} - A concrete class
 * - `string` - A string identifier
 * - `symbol` - A unique symbol identifier
 *
 * Symbols are recommended for library-level tokens to avoid naming collisions.
 *
 * @template T - The type resolved for this token
 */
export type InjectionToken<T = unknown> =
  | Type<T>
  | string
  | symbol;

/**
 * Represents the lifecycle of an injectable dependency.
 * The lifecycle determines how instances are created and reused by the DI.
 *
 * Available modes:
 * - `"singleton"` - One instance is created and shared for the lifetime of the container.
 * - `"transient"` - A new instance is created every time the dependency is resolved.
 * - `"request"` - A single instance is created per request, typically used in HTTP
 *  servers or similar scoped environments.
 */
export type InjectableMode = "singleton" | "transient" | "request";

/**
 * Interface used to specify the injection mode.
 */
export interface InjectableOptions {
  /**
   * The mode for the injector when resolving the value. If not specified,
   * defaults to `"singleton"`.
   */
  mode?: InjectableMode;
}

/**
 * Interface to control the field injection behaviour.
 */
export interface InjectOptions {
  /**
   * All dependency must be resolved by default. If this option is set to `true`
   * but the injector is unable to resolve the `InjectionToken`, the resolved
   * value will be `null` instead.
   *
   * @type {boolean}
   * @default false
   */
  optional?: boolean;
}

/**
 * Allowed types for tags.
 *
 * @note Symbols are recommended for library-level tokens to avoid naming collisions.
 */
export type Tag = string | symbol;

/**
 * Interface to control the recursive resolution behaviour.
 */
export interface RecursiveResolutionOption {
  /**
   * Resolve only related to the current module or include children (imported) modules.
   *
   * @default false
   */
  recursive?: boolean;
}
