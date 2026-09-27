<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  Module for integrating <a href="">Drizzle ORM</a> into the <a href="https://github.com/neonbyte1/denorid">Denorid</a> framework.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/drizzle">
    <img src="https://jsr.io/badges/@denorid/drizzle" alt="Denorid Drizzle ORM version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/drizzle
```

## Quick Start

```ts
import { DrizzleOrmModule, DrizzleService } from "@denorid/drizzle";
import { defineRelations } from "drizzle-orm";
import * as schema from "./db/schema.ts";

// drizzle-orm v1 builds `db.query` from relations, not from the schema bag
const relations = defineRelations(schema);

@Module({
  imports: [
    DrizzleOrmModule.register({
      type: "sqlite",
      database: "./local.db", // file path, `:memory:` or a libsql URL
      drizzle: { relations },
    }),
  ],
})
export class AppModule {}

// inside your application main
const drizzle = await ctx.resolve(DrizzleService);
const users = await drizzle
  .sqlite<typeof relations>()
  .query
  .users
  .findMany();

// closes the connections after all shutdown hooks ran
await ctx.close();
```

Factories registered with `registerAsync` can inject providers of other modules;
list those modules in `imports`:

```ts
DrizzleOrmModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    type: "postgres",
    connection: config.get("DATABASE_URL"),
    drizzle: { relations },
  }),
});
```

`DrizzleService` is available to modules that import the Drizzle module. Pass
`global: true` (`register(options, { global: true })` or as a `registerAsync`
option) to inject it in every module without importing it there.

The `migrations:generate` and `migrations:migrate` commands run the
`drizzle-kit` release matching the `drizzle-orm` version of this package.

## License

The [@denorid/drizzle](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
