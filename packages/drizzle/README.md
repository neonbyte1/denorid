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
import * as schema from "./db/schema.ts";

@Module({
  imports: [
    DrizzleOrmModule.register({
      type: "sqlite",
      database: ":memory:",
      drizzle: {
        schema,
        casing: "snake_case", // defaults to camelCase iirc
      },
    }),
  ],
})
export class AppModule {}

// inside your application main
const drizzle = await ctx.resolve(DrizzleService);
const users = await drizzle
  .sqlite<typeof schema>()
  .query
  .users
  .findMany();
```

## License

The [@denorid/drizzle](https://github.com/neonbyte1/denorid) package is [MIT licensed](../../LICENSE.md).
