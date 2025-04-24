import type { Constructor } from "../common_types.ts";
import type { GenericClassDecorator } from "./types.ts";

/**
 * Applies all `decorators` to the `target` class.
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
 * @param {(GenericClassDecorator | ClassDecorator)[]} decorators An array of class decorators to applie to the given `target`.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @returns {Constructor} This function will always return the decorated `target`.
 */
export function decorateConstructor(
  decorators: (GenericClassDecorator | ClassDecorator)[],
  target: Constructor,
): Constructor {
  decorators.reverse().forEach(
    (decorator: GenericClassDecorator | ClassDecorator) => {
      const decorated = (decorator as GenericClassDecorator)(target);
      if (decorated) {
        target = decorated;
      }
    },
  );
  return target;
}
