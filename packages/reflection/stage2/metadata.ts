import {
  InvalidArgumentError,
  type MetadataKey,
  type Target,
} from "../common_types.ts";
import type { MetadataFn } from "./types.ts";

/**
 * Weak map that holds every metadata defined using this module.
 *
 * @var {WeakMap} metadataCache
 */
const metadataCache = new WeakMap();

/**
 * Internal function to get the cache map of the `target`.
 *
 * @typeParam T The type of the metadata value.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property key which the `metadataKey` belongs to.
 * @returns This function retuns the metadata cache of the `target` if present, otherwise `undefined`.
 */
function getMetadataMap<T>(
  target: Target,
  propertyKey?: PropertyKey,
): Map<MetadataKey, T> | undefined {
  return metadataCache.get(target) &&
    metadataCache.get(target).get(propertyKey);
}

/**
 * Internal function to create the metadata cache map.
 *
 * @typeParam T The type of the metadata value.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property key which the `metadataKey` belongs to.
 * @returns {Map<MetadataKey, T>}
 */
function createMetadataMap<T>(
  target: Target,
  propertyKey?: PropertyKey,
): Map<MetadataKey, T> {
  const targetMetadata = metadataCache.get(target) ||
    new Map<PropertyKey | undefined, Map<MetadataKey, T>>();
  metadataCache.set(target, targetMetadata);
  const metadataMap = targetMetadata.get(propertyKey) ||
    new Map<MetadataKey, T>();
  targetMetadata.set(propertyKey, metadataMap);
  return metadataMap;
}

/**
 * Internal function to handle the lookup.
 *
 * Note: Does not continue the prototype chain lookup.
 *
 * @typeParam T The type of the metadata value.
 * @param {MetadataKey} metadataKey Key of the metadata.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property key which the `metadataKey` belongs to.
 * @returns {T | undefined} This function returns the cached metadata if present, otherwise `undefined`.
 */
function ordinaryGetOwnMetadata<T>(
  metadataKey: MetadataKey,
  target: Target,
  propertyKey?: PropertyKey,
): T | undefined {
  if (target === undefined || target === null) {
    throw new InvalidArgumentError(
      "target",
      ["object", "constructor"],
      target,
    );
  }
  const metadataMap = getMetadataMap<T>(target, propertyKey);
  return metadataMap && metadataMap.get(metadataKey);
}

/**
 * Internal function to validate and define the metadata.
 *
 * @typeParam T The type of the metadata value.
 * @param {MetadataKey} metadataKey Key of the metadata.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property key which the `metadataKey` belongs to.
 * @returns {T | undefined} This function returns the cached metadata if present, otherwise `undefined`.
 */
function ordinaryDefineOwnMetadata<T>(
  metadataKey: MetadataKey,
  T: T,
  target: Target,
  propertyKey?: PropertyKey,
): void {
  if (target === undefined || target === null) {
    throw new InvalidArgumentError(
      "target",
      ["object", "constructor"],
      target,
    );
  }
  if (
    propertyKey &&
    !["string", "number", "symbol"].includes(typeof propertyKey)
  ) {
    throw new InvalidArgumentError("propertyKey", [
      "string",
      "number",
      "symbol",
    ], propertyKey);
  }
  (
    getMetadataMap<T>(target, propertyKey) ||
    createMetadataMap<T>(target, propertyKey)
  ).set(metadataKey, T);
}

/**
 * Internal function to handle the lookup.
 *
 * Note: Does continue the prototype chain lookup.
 *
 * @typeParam T The type of the metadata value.
 * @param {MetadataKey} metadataKey Key of the metadata.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property key which the `metadataKey` belongs to.
 * @returns {T | undefined} This function returns the cached metadata if present, otherwise `undefined`.
 */
function ordinaryGetMetadata<T>(
  metadataKey: MetadataKey,
  target: Target,
  propertyKey?: PropertyKey,
): T | undefined {
  return ordinaryGetOwnMetadata<T>(metadataKey, target, propertyKey)
    ? ordinaryGetOwnMetadata<T>(metadataKey, target, propertyKey)
    : Object.getPrototypeOf(target)
    ? ordinaryGetMetadata(
      metadataKey,
      Object.getPrototypeOf(target),
      propertyKey,
    )
    : undefined;
}

/**
 * Defines metadata to an instantiated class or a class constructor.
 *
 * @example Usage
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * class Example {}
 * Reflection.defineMetadata("registry", "jsr", Example)
 * ```
 *
 * @example Instance based
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * class Example {}
 *
 * const instance = new Example()
 *
 * Reflection.defineMetadata("registry", "jsr", instance);
 * ```
 *
 * @example Instance based, with `propertyKey`
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * class Example {}
 *
 * const instance = new Example()
 *
 * Reflection.defineMetadata("registry", "jsr", instance, "example");
 * ```
 *
 * @typeParam T The type of the metadata value.
 * @param {MetadataKey} metadataKey
 * @param {T} metadataValue
 * @param {Target} target
 * @param {PropertyKey | undefined} [propertyKey]
 */
export function defineMetadata<T>(
  metadataKey: MetadataKey,
  T: T,
  target: Target,
  propertyKey?: PropertyKey,
): void {
  ordinaryDefineOwnMetadata(metadataKey, T, target, propertyKey);
}

/**
 * Gets the metadata from a target, does continue the prototype chain lookup.
 *
 * @example Usage
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * class Example {}
 * Reflection.defineMetadata("registry", "jsr", Example);
 *
 * console.log(Reflection.getMetadata<string>("registry", Example));
 * ```
 *
 * @example Instance based
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * class Example {}
 *
 * const instance = new Example()
 *
 * Reflection.defineMetadata("registry", "jsr", instance);
 *
 * console.log(Reflection.getMetadata<string>("registry", instance)); // "jsr"
 * console.log(Reflection.getMetadata<string>("registry", Example)); // undefined
 * ```
 *
 * @example Instance based, with `propertyKey`
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * class Example {}
 *
 * const instance = new Example()
 *
 * Reflection.defineMetadata("registry", "jsr", instance, "example");
 *
 * console.log(Reflection.getMetadata<string>("registry", instance, "example"));
 * ```
 * @typeParam T The type of the metadata value.
 *
 * @param {MetadataKey} metadataKey
 * @param {Target} target
 * @param {PropertyKey | undefined} [propertyKey]
 */
export function getMetadata<T>(
  metadataKey: MetadataKey,
  target: Target,
  propertyKey?: PropertyKey,
): T | undefined {
  return ordinaryGetMetadata<T>(metadataKey, target, propertyKey);
}

/**
 * Gets the metadata from a target, does not continue the prototype chain lookup.
 *
 * @see https://stackoverflow.com/a/48510371
 *
 * @example Usage
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * class Example {}
 * Reflection.defineMetadata("registry", "jsr", Example);
 *
 * console.log(Reflection.getOwnMetadata<string>("registry", Example));
 * ```
 *
 * @example Instance based
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * class Example {}
 *
 * const instance = new Example()
 *
 * Reflection.defineMetadata("registry", "jsr", instance);
 *
 * console.log(Reflection.getOwnMetadata<string>("registry", instance)); // "jsr"
 * console.log(Reflection.getOwnMetadata<string>("registry", Example)); // undefined
 * ```
 *
 * @example Instance based, with `propertyKey`
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * class Example {}
 *
 * const instance = new Example()
 *
 * Reflection.defineMetadata("registry", "jsr", instance, "example");
 *
 * console.log(Reflection.getOwnMetadata<string>("registry", instance, "example"));
 * ```
 * @typeParam T The type of the metadata value.
 *
 * @param {MetadataKey} metadataKey Key of the metadata.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property key which the `metadataKey` belongs to.
 * @returns {boolean} This function returns `true` if the given `metadataKey` is the prototype, otherwise `false`
 */
export function getOwnMetadata<T>(
  metadataKey: MetadataKey,
  target: Target,
  propertyKey?: PropertyKey,
): T | undefined {
  return ordinaryGetOwnMetadata<T>(
    metadataKey,
    target,
    propertyKey,
  );
}

/**
 * Checks if the `target` has metadata with the key of `metadataKey`, does continue the prototype chain lookup.
 *
 * @example Usage
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * @Reflection.metadata("author", "denorid")
 * class Foo {}
 *
 * class Bar extends Foo {}
 *
 * console.log(hasOwnMetadata.hasMetadata("author", Foo)); // true
 * console.log(hasOwnMetadata.hasMetadata("author", Bar)); // false
 *
 * ```
 *
 * @param {MetadataKey} metadataKey Key of the metadata.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property key which the `metadataKey` belongs to.
 * @returns {boolean} This function returns `true` if the given `metadataKey` is the prototype, otherwise `false`
 */
export function hasOwnMetadata(
  metadataKey: MetadataKey,
  target: Target,
  propertyKey?: PropertyKey,
): boolean {
  return !!ordinaryGetOwnMetadata(metadataKey, target, propertyKey);
}

/**
 * Checks if the `target` has metadata with the key of `metadataKey`, does continue the prototype chain lookup.
 *
 * @example Usage
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * @Reflection.metadata("author", "denorid")
 * class Foo {}
 *
 * class Bar extends Foo {}
 *
 * console.log(Reflection.hasMetadata("author", Foo)); // true
 * console.log(Reflection.hasMetadata("author", Bar)); // true
 *
 * ```
 *
 * @param {MetadataKey} metadataKey Key of the metadata.
 * @param {Target} target Either the instantiated target class or target class constructor.
 * @param {PropertyKey | undefined} [propertyKey] Optional: the property key which the `metadataKey` belongs to.
 * @returns {boolean} This function returns `true` if the given `metadataKey` is the prototype, otherwise `false`
 */
export function hasMetadata(
  metadataKey: MetadataKey,
  target: Target,
  propertyKey?: PropertyKey,
): boolean {
  return !!ordinaryGetMetadata(metadataKey, target, propertyKey);
}

/**
 * Creates a decorator to define metadata.
 *
 * @example Usage
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * @Reflection.metadata("author", "denorid")
 * class Example {}
 *
 * console.log(Reflection.getMetadata("author", Example)); // "denorid"
 * ```
 *
 * @typeParam T The type of the metadata value.
 * @param {MetadataKey} metadataKey Key of the metadata.
 * @param {T} metadataValue The metadata value.
 * @returns {MetadataFn} This functions returns a decorator.
 */
export function metadata<T>(
  metadataKey: MetadataKey,
  T: T,
): MetadataFn {
  return function decorator(target: Target, propertyKey?: PropertyKey): void {
    ordinaryDefineOwnMetadata<T>(
      metadataKey,
      T,
      target,
      propertyKey,
    );
  };
}
