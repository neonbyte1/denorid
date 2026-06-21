/**
 * @module
 *
 * `@keyv/redis`-backed storage adapter for {@link CachingModule}.
 *
 * The default export factory is {@link redisStore} - a re-export of
 * `createKeyv` under a denorid-friendly name. It returns a {@link Keyv}
 * instance ready to drop into `CachingModule.forRoot({ stores: [...] })`,
 * with `useKeyPrefix: false` already applied so the adapter's own namespace
 * is the only prefix on stored keys.
 *
 * @example In-memory + Redis
 * ```ts
 * import { Keyv } from "@denorid/caching";
 * import { redisStore } from "@denorid/caching/adapters/redis";
 *
 * CachingModule.forRoot({
 *   stores: [new Keyv(), redisStore("redis://localhost:6379", { namespace: "app" })],
 *   ttl: 60_000,
 * });
 * ```
 *
 * @example Redis Cluster
 * ```ts
 * import { Keyv } from "@denorid/caching";
 * import { createCluster, KeyvRedis } from "@denorid/caching/adapters/redis";
 *
 * const cluster = createCluster({ rootNodes: [{ url: "redis://127.0.0.1:7000" }] });
 * const store = new Keyv({ store: new KeyvRedis(cluster) });
 *
 * CachingModule.forRoot({ stores: [store] });
 * ```
 */
export {
  createClient,
  createCluster,
  createKeyv as redisStore,
  createKeyvNonBlocking as redisStoreNonBlocking,
  createSentinel,
  default as KeyvRedis,
} from "@keyv/redis";
export type {
  KeyvRedisOptions,
  RedisClientConnectionType,
  RedisClientOptions,
  RedisClientType,
  RedisClusterOptions,
  RedisClusterType,
  RedisSentinelType,
} from "@keyv/redis";
