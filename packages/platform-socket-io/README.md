<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  <a href="https://socket.io">socket.io</a> WebSocket adapter for
  <a href="https://github.com/neonbyte1/denorid">Denorid</a> gateways.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/platform-socket-io">
    <img src="https://jsr.io/badges/@denorid/platform-socket-io" alt="Denorid Platform socket.io version" />
  </a>
</p>

## Installation

```bash
# Deno
deno add jsr:@denorid/platform-socket-io
# Bun
bunx jsr add @denorid/platform-socket-io
# Node.js
npx jsr add @denorid/platform-socket-io
```

## Quick Start

Register the adapter on the HTTP application before it listens. Without it,
gateways use the HTTP adapter's native WebSocket adapter.

```ts
import { DenoridFactory } from "@denorid/core";
import { HonoAdapter } from "@denorid/platform-hono";
import { SocketIoAdapter } from "@denorid/platform-socket-io";
import { AppModule } from "./app_module.ts";

const app = await DenoridFactory.create(AppModule, new HonoAdapter());

app.useWebSocketAdapter(new SocketIoAdapter(app));
await app.listen(3000);
```

The second constructor argument takes
[socket.io server options](https://socket.io/docs/v4/server-options/) applied to
every socket.io server the adapter creates:

```ts
app.useWebSocketAdapter(
  new SocketIoAdapter(app, { cors: { origin: "https://example.com" } }),
);
```

## Runtime support

socket.io needs a `node:http` server. The adapter attaches to the server
returned by `app.getHttpServer()`, so on Deno and Bun the HTTP adapter serves
the whole application through `node:http` (`@hono/node-server` for
`HonoAdapter`) instead of `Deno.serve` / `Bun.serve` once socket.io is used.
Plain HTTP requests keep working next to socket.io on all runtimes.

## Gateways

```ts
import {
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  UseGuards,
  WebSocketGateway,
  WebSocketServer,
  WsContext,
  WsException,
  type WsResponse,
} from "@denorid/core";
import type { Server, Socket } from "@denorid/platform-socket-io";
import { z } from "zod";

const message = z.object({ room: z.string(), text: z.string() });

@WebSocketGateway()
export class ChatGateway
  implements OnGatewayConnection<Socket>, OnGatewayDisconnect<Socket> {
  @WebSocketServer()
  public server!: Server;

  public handleConnection(client: Socket): void {
    client.join("lobby");
  }

  public handleDisconnect(client: Socket): void {
    this.server.to("lobby").emit("left", client.id);
  }

  // Returned values are sent as acknowledgement.
  @SubscribeMessage("ping")
  public ping(): string {
    return "pong";
  }

  // A WsResponse is emitted as event instead.
  @SubscribeMessage("message")
  @MessageBody(message)
  @UseGuards(AuthGuard)
  public onMessage(
    ctx: WsContext<typeof message, Socket>,
  ): WsResponse<string> {
    if (!ctx.client.rooms.has(ctx.data.room)) {
      throw new WsException("Join the room first");
    }

    ctx.client.to(ctx.data.room).emit("message", ctx.data.text);

    return { event: "sent", data: ctx.data.text };
  }
}
```

Add the gateway to the `providers` of a module. `handleConnection` receives the
socket and its
[`handshake`](https://socket.io/docs/v4/server-socket-instance/#sockethandshake)
(headers, query, `auth`, address).

## Acknowledgements, events and exceptions

The payload is the first argument the client emits; further arguments are
ignored. What the client receives depends on the method's result:

| Result                                    | Client receives                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `undefined` (or no return)                | nothing                                                                        |
| `WsResponse` (`{ event, data }`)          | event `event` with `data`                                                      |
| any other value                           | the acknowledgement, when the client emitted with one                          |
| thrown `WsException`                      | event `exception` with `getPayload()`, no acknowledgement                      |
| any other error (not handled by a filter) | event `exception` with `{ status: "error", message: "Internal server error" }` |

```ts
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", { auth: { token } });

socket.on("exception", (error) => console.error(error));
socket.on("sent", (text) => console.log("sent", text));

console.log(await socket.emitWithAck("ping")); // "pong"
socket.emit("message", { room: "lobby", text: "hi" });
```

Like NestJS, a failed message never calls the acknowledgement, so `emitWithAck`
only settles on success. Use `socket.timeout(ms).emitWithAck()` on the client
when a message may fail.

## Namespaces and paths

- `namespace` selects a socket.io
  [namespace](https://socket.io/docs/v4/namespaces/). The gateway's
  `@WebSocketServer()` field and `afterInit` receive the `Namespace`; without a
  namespace they receive the `Server` (main namespace `/`).
- `path` is the engine.io path, `/socket.io` by default.
- Gateways sharing a `path` share one socket.io `Server`. Its server options
  come from the adapter options merged with the options of the first gateway
  created for that path; server options of later gateways on the same path are
  ignored.

```ts
import type { SocketIoGatewayOptions } from "@denorid/platform-socket-io";

@WebSocketGateway<SocketIoGatewayOptions>({
  namespace: "/admin",
  cors: { origin: "https://admin.example.com" },
})
export class AdminGateway {}
```

## Shutdown

When the application closes, the adapter disconnects the clients of every
gateway namespace (`io server disconnect`, clients do not reconnect) and closes
the engine.io server. It never calls socket.io's `io.close()`, because that
would close the HTTP server, which belongs to the HTTP adapter.

## License

The [@denorid/platform-socket-io](https://github.com/neonbyte1/denorid) package
is [MIT licensed](../../LICENSE.md).
