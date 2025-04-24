import {
  type Constructor,
  EmptyArrayArgumentError,
  InvalidArgumentError,
  type Target,
} from "../common_types.ts";
import { decorateConstructor } from "./decorate_constructor.ts";
import { decorateProperty } from "./decorate_property.ts";
import type {
  Decorator,
  GenericClassDecorator,
  MemberDecorator,
} from "./types.ts";

/**
 * Decorates a class constructor.
 *
 * @example Usage
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * class Example {}
 *
 * Reflection.decorate([
 *   <T>(target: Constructor<T>): void => {
 *     console.log(`Decorated class ${target.name}`);
 *   },
 * ], Example);
 * ```
 *
 * @param {(ClassDecorator | GenericClassDecorator)[]} decorators Array of class decorators
 * @param {Constructor} target The target class constructor.
 * @returns {Constructor} This function will always return the `target` class constructor.
 */
export function decorate(
  decorators: (ClassDecorator | GenericClassDecorator)[],
  target: Constructor,
): Constructor;
/**
 * Decorates an instantiated class or a class constructor, optionally via property key.
 *
 * @example Usage
 * ```ts ignore
 * import { type Constructor, Reflection, type Target } from "@denorid/reflection";
 *
 * class Example {}
 *
 * Reflection.decorate(
 *   [
 *     (target: Target, propertyKey: PropertyKey): void => {
 *       console.log(
 *         `Decorated property ${
 *           typeof propertyKey === "symbol" ? String(propertyKey) : propertyKey
 *         } of class ${(target as Constructor).name}`,
 *       );
 *     },
 *   ],
 *   Example,
 *   "foo",
 * );
 * ```
 *
 * @param {MemberDecorator[]} decorators An array of member decorators.
 * @param {object} target The instantiated target class.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property to decorate.
 * @param {PropertyDescriptor | undefined} [attributes] Optional: the property descriptor configuration.
 * @returns {PropertyDescriptor | undefined} This function returns either the descriptor returned from the decorator or the `attributes`.
 */
export function decorate(
  decorators: MemberDecorator[],
  target: object,
  propertyKey?: PropertyKey,
  attributes?: PropertyDescriptor,
): PropertyDescriptor | undefined;
/**
 * Actual implementation of the overloads.
 *
 * @example Usage
 * ```ts ignore
 * import { type Constructor, Reflection, type Target } from "@denorid/reflection";
 *
 * class Example {}
 *
 * // using the constructor overload
 * Reflection.decorate([
 *   <T>(target: Constructor<T>): void => {
 *     console.log(`Decorated class ${target.name}`);
 *   },
 * ], Example);
 *
 * // using the property overload
 * Reflection.decorate(
 *   [
 *     (target: Target, propertyKey: PropertyKey): void => {
 *       console.log(
 *         `Decorated property ${
 *           typeof propertyKey === "symbol" ? String(propertyKey) : propertyKey
 *         } of class ${(target as Constructor).name}`,
 *       );
 *     },
 *   ],
 *   Example,
 *   "foo",
 * );
 * ```
 *
 * @param {Decorator[]} decorators An array of class- or member decorators.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property to decorate.
 * @param {PropertyDescriptor | undefined} [attributes] Optional: the property descriptor configuration.
 * @returns {Constructor | PropertyDescriptor | undefined} The return type depends on the function call.
 */
export function decorate(
  decorators: Decorator[],
  target: Target,
  propertyKey?: PropertyKey,
  attributes?: PropertyDescriptor,
): Constructor | PropertyDescriptor | undefined {
  if (target === undefined || target === null) {
    throw new InvalidArgumentError(
      "target",
      ["object", "constructor"],
      target,
    );
  }

  if (!Array.isArray(decorators)) {
    throw new InvalidArgumentError("decorators", "array", decorators);
  }
  if (decorators.length === 0) {
    throw new EmptyArrayArgumentError("decorators");
  }

  if (propertyKey !== undefined) {
    return decorateProperty(
      decorators as MemberDecorator[],
      target,
      propertyKey,
      attributes,
    );
  }

  if (typeof target === "function") {
    return decorateConstructor(
      decorators as ClassDecorator[],
      target as Constructor,
    );
  }

  return;
}
