import {
  GLOBAL_MODULE_METADATA,
  INJECTABLE_METADATA,
  type InjectableMetadata,
  INJECTION_METADATA,
  type InjectionDependency,
  MODULE_METADATA,
  TAG_METADATA,
} from "./_metadata.ts";
import type { InjectionToken, Tag, Type } from "./common.ts";
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnBeforeApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from "./hooks.ts";
import type { DynamicModule, ModuleMetadata } from "./modules.ts";
import type {
  BaseProvider,
  ClassProvider,
  ExistingProvider,
  FactoryProvider,
  Provider,
  ValueProvider,
} from "./provider.ts";

/**
 * Base interface for provider guard check options.
 */
interface ProviderCheckOptions {
  /**
   * If set to `true` then {@linkcode isBaseProvider} won't be called before validating
   * the _use_ field of a provider.
   *
   * @default false
   */
  excludeBaseCheck?: boolean;
}

export function isBaseProvider(
  data: unknown,
  options?: ProviderCheckOptions,
): data is BaseProvider {
  return typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    (options?.excludeBaseCheck ? true : "provide" in data);
}

export function isClassProvider(
  data: unknown,
  options?: ProviderCheckOptions,
): data is ClassProvider {
  return isBaseProvider(data, options) && "useClass" in data;
}

export function isFactoryProvider(
  data: unknown,
  options?: ProviderCheckOptions,
): data is FactoryProvider {
  return isBaseProvider(data, options) && "useFactory" in data;
}

export function isValueProvider(
  data: unknown,
  options?: ProviderCheckOptions,
): data is ValueProvider {
  return isBaseProvider(data, options) && "useValue" in data;
}

export function isExistingProvider(
  data: unknown,
  options?: ProviderCheckOptions,
): data is ExistingProvider {
  return isBaseProvider(data, options) && "useExisting" in data;
}

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

export function getProviderToken(provider: Provider): InjectionToken {
  return typeof provider === "function" ? provider : provider.provide;
}

export function getInjectableMetadata(
  target: Type,
): InjectableMetadata | undefined {
  return target[Symbol.metadata]?.[INJECTABLE_METADATA] as
    | InjectableMetadata
    | undefined;
}

export function getInjectionDependencies(target: Type): InjectionDependency[] {
  return (target[Symbol.metadata]
    ?.[INJECTION_METADATA] as InjectionDependency[]) ??
    [];
}

export function getModuleMetadata(target: Type): ModuleMetadata | undefined {
  return target[Symbol.metadata]?.[MODULE_METADATA] as
    | ModuleMetadata
    | undefined;
}

export function isGlobalModule(target: Type): boolean {
  return target[Symbol.metadata]?.[GLOBAL_MODULE_METADATA] === true;
}

export function getTags(target: Type): Tag[] {
  return target[Symbol.metadata]?.[TAG_METADATA] as (Tag[] | undefined) ?? [];
}
