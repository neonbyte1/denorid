<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  Caching module for Denorid - wires <a href="https://github.com/jaredwray/cacheable/tree/main/packages/cache-manager">cache-manager</a>
  (v7) and <a href="https://keyv.org">Keyv</a> into the Denorid dependency injector.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/caching">
    <img src="https://jsr.io/badges/@denorid/caching" alt="Denorid caching version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/caching
```

## Quick Start

### In-memory default

```ts
@Module({
  imports: [
    CachingModule.forRoot({ ttl: 60_000 }),
  ],
})
export class AppModule {}
```

### Multi-tier (in-memory + Redis)

```ts
import { Keyv } from "@denorid/caching";
import { redisStore } from "@denorid/caching/adapters/redis";

@Module({
  imports: [
    CachingModule.forRoot({
      stores: [
        new Keyv(),
        redisStore("redis://localhost:6379", { namespace: "app" }),
      ],
      ttl: 60_000,
    }),
  ],
})
export class AppModule {}
```

### Async configuration

```ts
@Module({
  imports: [
    CachingModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ttl: config.get("CACHE_TTL"),
      }),
    }),
  ],
})
export class AppModule {}
```

## Using the Cache

```ts
import { type Cache, InjectCache } from "@denorid/caching";

@Injectable()
export class UserService {
  @InjectCache()
  private readonly cache!: Cache;

  async get(id: string): Promise<User> {
    return this.cache.wrap(`user:${id}`, () => this.load(id), 10_000);
  }

  private load(id: string): Promise<User> {
    // ...
  }
}
```

The injected value is the `cache-manager` `Cache` instance - `set`, `get`,
`del`, `wrap`, `mget`, `mset`, and `disconnect` all work as documented in the
[cache-manager docs](https://github.com/jaredwray/cacheable/tree/main/packages/cache-manager).
`disconnect` is called automatically on module shutdown, so user-supplied Keyv
stores (Redis, SQLite, ...) clean up cleanly.

## Adapters

`@denorid/caching/adapters/redis` re-exports `@keyv/redis` under denorid-style
names. For other Keyv backends (`@keyv/sqlite`, `@keyv/postgres`, ...) wrap
them yourself:

```ts
import { Keyv } from "@denorid/caching";
import KeyvSqlite from "npm:@keyv/sqlite";

CachingModule.forRoot({
  stores: [new Keyv({ store: new KeyvSqlite("sqlite://cache.db") })],
});
```

## License

The [@denorid/caching](https://github.com/neonbyte1/denorid) package is [MIT licensed](../../LICENSE.md).
