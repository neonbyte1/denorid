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
# Deno
deno add jsr:@denorid/platform-hono
# Bun
bunx jsr add @denorid/platform-hono
# Node.js
npx jsr add @denorid/platform-hono
```

## Runtime support

`HonoAdapter` serves the app through the native HTTP server of the runtime it
runs on: `Deno.serve` on Deno, `Bun.serve` on Bun and
[`@hono/node-server`](https://github.com/honojs/node-server) on Node.js.

## Quick Start

```ts
import { DenoridFactory } from "@denorid/core";
import { HonoAdapter } from "@denorid/platform-hono";
import { AppModule } from "./app_module.ts";

const app = await DenoridFactory.create(AppModule, new HonoAdapter());
await app.listen();
```

## Static files

Serve a directory, e.g. a Vite build, for `GET` and `HEAD` requests no
controller route matches:

```ts
const app = await DenoridFactory.create(
  AppModule,
  new HonoAdapter({
    staticFiles: {
      root: "./dist",
      // answered to page requests (`Accept: text/html`) nothing else matches
      fallback: "index.html",
      // content hashed files, cached for a year; everything else revalidates
      immutable: "assets",
    },
  }),
  { basePath: "/api" },
);
```

- Controller routes always win over files.
- Paths at or below `basePath` are never served from `root`, so unknown API
  routes answer `404` instead of the fallback page.
- Hidden files and directories (`.env`, `.git/`) are never served, except
  `/.well-known/`.
- Responses carry `ETag` and `Last-Modified`; conditional requests are answered
  with `304 Not Modified`.
- `root` has to be a directory and `fallback` a file below it, otherwise the
  application fails to start.

## Client IP

`RequestContext.ip` is the socket peer address by default; forwarding headers
are ignored because any client can send them. Behind a reverse proxy, declare
which proxies are trusted:

```ts
new HonoAdapter({
  clientIp: {
    // `true`, a hop count, addresses/CIDR ranges or `(address, hop) => boolean`
    trustProxy: ["loopback", "10.0.0.0/8"],
    // header carrying the forwarded addresses, default "x-forwarded-for"
    header: "x-forwarded-for",
  },
});
```

Starting at the socket peer, the forwarded addresses are walked from right to
left while the current address is a trusted proxy; the first untrusted address
is the client. `loopback`, `linklocal` and `uniquelocal` expand to the matching
IPv4 and IPv6 ranges. Addresses are returned in canonical form (IPv4-mapped IPv6
addresses as IPv4, IPv6 compressed and lower case); `"0.0.0.0"` means the peer
address is unknown. Use `header: "cf-connecting-ip"` or `header: "x-real-ip"`
for proxies that set a single address.

## License

The [@denorid/platform-hono](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
