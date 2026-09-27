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

`getHttpServer()` switches to a `node:http` server on every runtime and returns
it, e.g. to attach socket.io. Call it before `listen()`.

## Quick Start

```ts
import { DenoridFactory } from "@denorid/core";
import { HonoAdapter } from "@denorid/platform-hono";
import { AppModule } from "./app_module.ts";

const app = await DenoridFactory.create(AppModule, new HonoAdapter());
await app.listen();
```

## Routing and responses

- Every entry of a controller or route path array is its own route:
  `@Get(["a", "b"])` answers `/a` and `/b`.
- A controller `host` option (string, RegExp or an array of both) is matched
  against the request hostname; requests for other hosts go on to the next
  route, the static files or the `404`.
- `@Head()` routes answer `HEAD` requests, also when a `@Get()` route has the
  same path. Without a `@Head()` route, `HEAD` is answered by the `GET` route
  without body.
- With `cors` enabled, preflight (`OPTIONS`) requests on route paths are
  answered with the CORS headers; the controller is not called.
- Results: a `Response` is sent as is, strings, numbers, booleans, bigints and
  symbols as text, other objects as JSON, with the `@HttpCode()` status or
  `200`. `undefined`/`null` send an empty body with the `@HttpCode()` status or
  `204`.
- Errors: an `HttpException` is sent with its body and status. Any other error
  is answered with the standard `500` body
  (`{"message":"Internal Server Error","statusCode":500}`); its message is only
  logged.
- Exception filter results: a `Response` is sent as is; when several filters
  return a value, the first `Response` among them is sent. An `HttpException` is
  sent with its body and status. Other values are serialized like controller
  results, with the status of the handled error (`500` unless it is an
  `HttpException`).
- Every request gets its own DI context id (`RequestContext.contextId`, a random
  UUID); an `x-request-id` header is not used for it.

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
- Single byte ranges (`Range: bytes=...`, honoring `If-Range`) are answered with
  `206 Partial Content`, e.g. for video seeking. Multiple ranges are ignored and
  the whole file is sent.
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

## WebSockets

`@WebSocketGateway()` classes run on the native `WsAdapter` by default, no setup
needed. It upgrades through the Hono WebSocket helper of the runtime:
`Deno.serve` on Deno, `Bun.serve` on Bun, `node:http` with
[`ws`](https://github.com/websockets/ws) on Node.js (and after
`getHttpServer()`).

```ts
import {
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type WsContext,
  WsException,
  type WsResponse,
} from "@denorid/core";
import type { WsClient, WsServer } from "@denorid/platform-hono";
import { z } from "zod";

const message = z.object({ room: z.string(), text: z.string() });

@WebSocketGateway({ path: "/chat" })
export class ChatGateway implements OnGatewayConnection<WsClient> {
  @WebSocketServer()
  public server!: WsServer;

  public handleConnection(client: WsClient): void {
    // the upgrade request stays readable, e.g. for cookies
    console.log(client.id, client.request.headers.get("cookie"));
  }

  @SubscribeMessage("join")
  @MessageBody(z.string())
  public onJoin(ctx: WsContext<z.ZodString, WsClient>): string {
    ctx.client.join(ctx.data);

    return "joined"; // reply to this message
  }

  @SubscribeMessage("message")
  @MessageBody(message)
  public onMessage(
    ctx: WsContext<typeof message, WsClient>,
  ): WsResponse<string> {
    if (!ctx.client.rooms.has(ctx.data.room)) {
      throw new WsException("Join the room first");
    }

    this.server.to(ctx.data.room).emit("message", ctx.data.text);

    return { event: "sent", data: ctx.data.text }; // event to the sender
  }
}
```

- Gateways with the same `path` (default `/`) share one `WsServer`. Their
  handlers are merged per client; a later binding of the same event replaces the
  earlier one. `namespace` is not supported, use `@denorid/platform-socket-io`
  for namespaces.
- A plain HTTP request to a gateway path still reaches the controller route on
  that path. Upgrades bypass the controller pipeline, so CORS and other route
  middleware do not apply to them.
- To use another transport, e.g. socket.io:
  `app.useWebSocketAdapter(new SocketIoAdapter(app))` before `listen()`.

### Protocol

JSON text frames, compatible with the NestJS `WsAdapter`:

| Direction        | Frame                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| client to server | `{ "event": string, "data"?: unknown, "id"?: string \| number }`                               |
| event            | `{ "event": string, "data": unknown }` (`WsResponse` results, `emit`, broadcasts)              |
| reply            | `{ "id": id, "data": result }` with an `id`, the JSON of the result as is without one          |
| error            | `{ "event": "exception", "data": payload, "id"?: id }` (`WsException` payload, unknown events) |

Handlers returning `undefined` send nothing. Other errors are sent as
`{ "status": "error", "message": "Internal server error" }`. Unknown events are
only answered when the message has an `id`. Invalid JSON, messages without a
string `event` and binary frames are ignored.

### `WsServer` and `WsClient`

| `WsServer`                    | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `path`                        | URL path of the server                                          |
| `clients`                     | connected clients (`ReadonlySet<WsClient>`)                     |
| `emit(event, data?)`          | sends an event to every client                                  |
| `to(room \| rooms).emit(...)` | sends an event to the clients in any of the rooms, at most once |

| `WsClient`                          | Description                                       |
| ----------------------------------- | ------------------------------------------------- |
| `id`                                | unique id of the connection                       |
| `request`                           | the upgrade request (URL and headers)             |
| `rooms`                             | joined rooms, left automatically on disconnect    |
| `readyState`                        | `0` connecting, `1` open, `2` closing, `3` closed |
| `send(data)` / `emit(event, data?)` | raw data / an event frame, ignored unless open    |
| `join(room)` / `leave(room)`        | room membership                                   |
| `close(code?, reason?)`             | closes the connection                             |

### Browser client

```ts
const socket = new WebSocket("ws://localhost:3000/chat");
const pending = new Map<number, (data: unknown) => void>();
let nextId = 0;

function request(event: string, data: unknown): Promise<unknown> {
  const id = ++nextId;
  const { promise, resolve } = Promise.withResolvers<unknown>();

  pending.set(id, resolve);
  socket.send(JSON.stringify({ event, data, id }));

  return promise;
}

socket.onmessage = ({ data }) => {
  const frame = JSON.parse(data);

  if (frame.id !== undefined && pending.has(frame.id)) {
    pending.get(frame.id)!(frame.data); // reply or exception
    pending.delete(frame.id);
  } else {
    console.log(frame.event, frame.data); // event
  }
};

socket.onopen = async () => {
  await request("join", "lobby"); // "joined"
  socket.send(
    JSON.stringify({ event: "message", data: { room: "lobby", text: "hi" } }),
  );
};
```

## License

The [@denorid/platform-hono](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
