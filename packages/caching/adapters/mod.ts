/**
 * @module
 *
 * Storage adapters for `@denorid/caching`. Re-exports every adapter sub-module
 * so `import { redisStore } from "@denorid/caching/adapters"` works alongside
 * the narrower `import { redisStore } from "@denorid/caching/adapters/redis"`.
 *
 * Each adapter sub-module pulls in its own backend's npm dep only when
 * imported - Deno resolves npm specifiers lazily, so this barrel does not
 * force the Redis client on consumers that only reach for a different adapter.
 */
export * from "./redis.ts";
