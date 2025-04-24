import type { Target } from "../common_types.ts";
import type { MemberDecorator } from "./types.ts";

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
 * ```   *
 *
 * @param {MemberDecorator[]} decorators An array of member decorators.
 * @param {Target} target The instantiated target class.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property to decorate.
 * @param {PropertyDescriptor | undefined} [attributes] Optional: the property descriptor configuration.
 * @returns {PropertyDescriptor | undefined} This function returns either the descriptor returned from the decorator or the `attributes`.
 */
export function decorateProperty(
  decorators: MemberDecorator[],
  target: Target,
  propertyKey: PropertyKey,
  descriptor?: PropertyDescriptor,
): PropertyDescriptor | undefined {
  decorators.reverse().forEach((decorator: MemberDecorator) => {
    descriptor = decorator(target, propertyKey, descriptor) || descriptor;
  });
  return descriptor;
}
