import type { InjectableMetadata, InjectionDependency } from "./_metadata.ts";
import type { InjectionToken, Tag, Type } from "./common.ts";
import {
  GLOBAL_MODULE_METADATA,
  INJECTABLE_METADATA,
  INJECTION_METADATA,
  MODULE_METADATA,
  TAG_METADATA,
} from "./constants.ts";
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnBeforeApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from "./hooks.ts";
import type { DynamicModule, ModuleMetadata } from "./modules.ts";

export function isDynamicModule(
  data: unknown,
): data is DynamicModule {
  return typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    typeof (data as DynamicModule).module === "function";
}

export function hasOnModuleInit(
  instance: unknown,
): instance is OnModuleInit {
  return typeof instance === "object" &&
    typeof (instance as OnModuleInit)?.onModuleInit === "function";
}

export function hasOnApplicationBootstrap(
  instance: unknown,
): instance is OnApplicationBootstrap {
  return typeof instance === "object" &&
    typeof (instance as OnApplicationBootstrap)?.onApplicationBootstrap ===
      "function";
}

export function hasOnModuleDestroy(
  instance: unknown,
): instance is OnModuleDestroy {
  return typeof instance === "object" &&
    typeof (instance as OnModuleDestroy)?.onModuleDestroy === "function";
}

export function hasOnBeforeApplicationShutdown(
  instance: unknown,
): instance is OnBeforeApplicationShutdown {
  return typeof instance === "object" &&
    typeof (instance as OnBeforeApplicationShutdown)
        ?.onBeforeApplicationShutdown === "function";
}

export function hasOnApplicationShutdown(
  instance: unknown,
): instance is OnApplicationShutdown {
  return typeof instance === "object" &&
    typeof (instance as OnApplicationShutdown)?.onApplicationShutdown ===
      "function";
}

export function serializeToken(token: InjectionToken): string {
  switch (typeof token) {
    case "function":
      return token.name || "<anonymous class>";

    case "symbol":
      return token.toString();

    default:
      return token;
  }
}

/**
 * Reads the {@linkcode InjectableMetadata} stored on `target` via `Symbol.metadata`.
 *
 * @param {Type} target - The class to read the metadata from.
 * @returns {InjectableMetadata | undefined} The injectable metadata, or `undefined` if the class is not decorated with `@Injectable`.
 */
export function getInjectableMetadata(
  target: Type,
): InjectableMetadata | undefined {
  return target[Symbol.metadata]?.[INJECTABLE_METADATA] as
    | InjectableMetadata
    | undefined;
}

/**
 * Reads the list of constructor injection dependencies stored on `target` via `Symbol.metadata`.
 *
 * @param {Type} target - The class to read the dependencies from.
 * @returns {InjectionDependency[]} The list of injection dependencies, or an empty array if none are registered.
 */
export function getInjectionDependencies(target: Type): InjectionDependency[] {
  return (target[Symbol.metadata]
    ?.[INJECTION_METADATA] as InjectionDependency[]) ??
    [];
}

/**
 * Reads the {@linkcode ModuleMetadata} stored on `target` via `Symbol.metadata`.
 *
 * @param {Type} target - The class to read the metadata from.
 * @returns {ModuleMetadata | undefined} The module metadata, or `undefined` if the class is not decorated with `@Module`.
 */
export function getModuleMetadata(target: Type): ModuleMetadata | undefined {
  return target[Symbol.metadata]?.[MODULE_METADATA] as
    | ModuleMetadata
    | undefined;
}

/**
 * Checks whether `target` has been marked as a global module.
 *
 * @param {Type} target - The class to check.
 * @returns {boolean} `true` if the class is decorated with `@Global`.
 */
export function isGlobalModule(target: Type): boolean {
  return target[Symbol.metadata]?.[GLOBAL_MODULE_METADATA] === true;
}

/**
 * Reads the list of tags stored on `target` via `Symbol.metadata`.
 *
 * @param {Type} target - The class to read the tags from.
 * @returns {Tag[]} The list of tags, or an empty array if none are registered.
 */
export function getTags(target: Type): Tag[] {
  return target[Symbol.metadata]?.[TAG_METADATA] as (Tag[] | undefined) ?? [];
}
