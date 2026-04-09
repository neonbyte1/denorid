<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  Module for integrating <a href="https://hono.dev">Hono</a> into the <a href="https://github.com/neonbyte1/denorid">Denorid</a> framework.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/plaform-hono">
    <img src="https://jsr.io/badges/@denorid/platform-hono" alt="Denorid Platform Hono version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/platform-hono
```

## Quick Start

```ts
import { DenoridFactory } from "@denorid/core";
import { HonoAdapter } from "@denorid/platform-hono";
import { AppModule } from "./app_module.ts";

const app = await DenoridFactory.create(AppModule, new HonoAdapter());
await app.listen();
```

## License

The [@denorid/platform-hono](https://github.com/neonbyte1/denorid) package is [MIT licensed](../../LICENSE.md).
