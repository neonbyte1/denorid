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

/**
 * Generic Stage 3 decorator signature.
 *
 * @template Context - The decorator context type (e.g., `ClassDecoratorContext`, `ClassFieldDecoratorContext`, etc.)
 * @template Target - The target type
 * @template Return - The decorator function return type
 */
export type Decorator<Context, Target = unknown, Return = void> = (
  target: Target,
  ctx: Context,
) => Return;

/**
 * Type definition for a class decorator method.
 *
 * This type represents the signature of any class method, capturing its context (`this`),
 * parameters, and return value. It's used as a constraint for method decorators to ensure
 * they're only applied to valid class methods.
 *  *
 * @template T - The type of the class instance that the method belongs to
 *
 * @param this - The class instance context (implicit parameter)
 * @param args - Any number of arguments of any type
 * @returns Any value type
 */
export type ClassMethodDecoratorInitializer<T> = (
  this: T,
  // deno-lint-ignore no-explicit-any
  ...args: any[]
  // deno-lint-ignore no-explicit-any
) => any;

/**
 * Type definition for a method decorator compatible with TypeScript's decorator metadata.
 *
 * This type represents a function that can be used as a method decorator in TypeScript.
 * It follows the TC39 decorator specification and TypeScript's implementation, providing
 * type-safe decorator creation with proper context information.
 *
 * @template T - The type of the class instance that owns the method
 * @template V - The type of the method being decorated (extends ClassMethodDecoratorInitializer<T>)
 *
 * @param {V} target - The method being decorated
 * @param {ClassMethodDecoratorContext<T, V>} context - Metadata about the method and its context
 * @returns The original method or a replacement method with the same signature
 *
 * @see {@link https://github.com/tc39/proposal-decorators | TC39 Decorator Proposal}
 * @see {@link https://www.typescriptlang.org/docs/handbook/decorators.html | TypeScript Decorators}
 */
export type MethodDecorator = <
  T extends object,
  V extends ClassMethodDecoratorInitializer<T>,
>(
  target: V,
  context: ClassMethodDecoratorContext<T, V>,
) => V;
