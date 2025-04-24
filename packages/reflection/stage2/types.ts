// deno-lint-ignore-file no-explicit-any
import type { Constructor, Target } from "../common_types.ts";

/**
 * A union type representing any valid decorator.
 *
 * Can be a class decorator, a generic class decorator (with optional return),
 * or a member decorator (method, accessor, or property).
 */
export type Decorator =
  | ClassDecorator
  | GenericClassDecorator
  | MemberDecorator;

/**
 * A decorator for class members, such as methods or properties.
 *
 * @typeParam T The type of the member being decorated.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property key which the `metadataKey` belongs to.
 * @param {PropertyDescriptor | undefined} [descriptor] The property descriptor for the member, if available.
 *
 * @returns This function might return a new property descriptor or nothing (basically `undefined`).
 */
export type MemberDecorator = <T = any>(
  target: Target,
  propertyKey: PropertyKey,
  descriptor?: TypedPropertyDescriptor<T>,
) => TypedPropertyDescriptor<T> | void;
/**
 * A decorator for classes that allows returning a new constructor.
 *
 * @typeParam T The instance type of the class being decorated.
 * @param {Constructor} target The target class constructor.
 * @returns This functions returns either the decorated target `Constructor` or the `target` input.
 */
export type GenericClassDecorator = <T = any>(
  target: Constructor<T>,
) => Constructor<T> | void;

export type MetadataFn = (target: Target, propertyKey?: PropertyKey) => void;
