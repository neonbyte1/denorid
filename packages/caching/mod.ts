/**
 * @module
 *
 * Caching package for Denorid - wires `cache-manager` v7 (backed by any
 * Keyv-compatible storage adapter) into the Denorid dependency injector.
 *
 * Decorator-based HTTP response caching is intentionally absent - Denorid has
 * no interceptor primitive, so the NestJS `@CacheKey` / `@CacheTTL` /
 * `CacheInterceptor` trio would be dead API here.
 *
 * ### Quick start
 *
 * ```ts
 * // In-memory default
 * CachingModule.forRoot({ ttl: 60_000 });
 *
 * // Multi-tier (in-memory + Redis)
 * import { Keyv } from "@denorid/caching";
 * import { redisStore } from "@denorid/caching/adapters/redis";
 * CachingModule.forRoot({
 *   stores: [new Keyv(), redisStore("redis://localhost:6379", { namespace: "app" })],
 *   ttl: 60_000,
 * });
 * ```
 *
 * ### Exports
 *
 * | Symbol | Description |
 * |---|---|
 * | {@link CachingModule} | Denorid module - register with `forRoot` or `forRootAsync` |
 * | {@link CACHE_MANAGER} | Injection token resolving to the {@link Cache} instance |
 * | {@link InjectCache} | Field decorator shorthand for `@Inject(CACHE_MANAGER)` |
 * | {@link CachingModuleOptions} | Sync module configuration |
 * | {@link CachingAsyncModuleOptions} | Async module configuration |
 * | {@link Cache} | Re-export of cache-manager's `Cache` type |
 * | `redisStore` | (`./adapters/redis`) Factory returning a `Keyv` backed by `@keyv/redis` |
 */
export * from "./decorator.ts";
export * from "./module.ts";
export * from "./module_options.ts";
