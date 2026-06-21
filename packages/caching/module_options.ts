import type {
  GenericFunction,
  InjectionToken,
  ModuleMetadata,
  Provider,
} from "@denorid/injector";
import type { Cache, CreateCacheOptions, Events } from "cache-manager";
import type { Keyv, KeyvStoreAdapter } from "keyv";

export type { Cache, CreateCacheOptions, Events, Keyv, KeyvStoreAdapter };

/**
 * Module-level configuration for the caching package.
 *
 * Values become defaults applied to every cache operation and may be
 * overridden per-call when the underlying `cache-manager` API supports it.
 */
export interface CachingModuleOptions {
  /** When `true`, registers the caching module as a global provider. */
  global?: boolean;
  /**
   * Keyv stores layered in priority order. Omit for an in-memory default -
   * `cache-manager` spins up its own Keyv instance.
   */
  stores?: Keyv[];
  /** Default time-to-live in milliseconds applied to every `set` / `wrap`. */
  ttl?: number;
  /**
   * Refresh remaining-TTL threshold in milliseconds. When the cached value's
   * remaining TTL drops below this threshold, `wrap` triggers an async refresh.
   */
  refreshThreshold?: number;
  /**
   * When `true`, `wrap` refresh writes to every store - not just the one that
   * served the cache hit.
   */
  refreshAllStores?: boolean;
  /**
   * When `true`, multi-store operations race instead of awaiting every store.
   * See `cache-manager`'s documentation for per-operation semantics.
   */
  nonBlocking?: boolean;
  /** Stable cache identifier used by `wrap` to avoid cross-instance collisions. */
  cacheId?: string;
}

/**
 * Async configuration options for the caching module.
 *
 * Use with {@link CachingModule.forRootAsync} when options must be resolved
 * asynchronously from other providers (e.g. a config service).
 */
export interface CachingAsyncModuleOptions
  extends Pick<ModuleMetadata, "imports"> {
  /** When `true`, registers the caching module as a global provider. */
  global?: boolean;
  /**
   * Factory function that produces the module options.
   *
   * Injected values listed in {@link inject} are forwarded as positional arguments;
   * declare your factory with concrete parameter types - the framework wraps it
   * through a permissive callable signature so the narrower types are preserved.
   *
   * @return {Omit<CachingModuleOptions, "global"> | Promise<Omit<CachingModuleOptions, "global">>}
   *   Resolved module options (without `global`).
   */
  useFactory: GenericFunction<
    | Omit<CachingModuleOptions, "global">
    | Promise<Omit<CachingModuleOptions, "global">>
  >;
  /** Injection tokens passed as arguments to {@link useFactory}. */
  inject?: InjectionToken[];
  /** Additional providers registered alongside the cache provider. */
  extraProviders?: Provider[];
}
