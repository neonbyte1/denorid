<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  Core module of the <a href="https://github.com/neonbyte1/denorid">Denorid</a> framework.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/core">
    <img src="https://jsr.io/badges/@denorid/core" alt="Denorid core version" />
  </a>
</p>

## Installation

```bash
# Deno
deno add jsr:@denorid/core
# Bun
bunx jsr add @denorid/core
# Node.js
npx jsr add @denorid/core
```

## Quick Start

```ts
import { DenoridFactory } from "@denorid/core";
import { HonoAdapter } from "@denorid/platform-hono";
import { AppModule } from "./app_module.ts";

const app = await DenoridFactory.create(AppModule, new HonoAdapter());
app.listen();
```

## WebSockets

Gateways handle WebSocket messages the way controllers handle HTTP requests.
They follow [NestJS gateways](https://docs.nestjs.com/websockets/gateways) with
one difference: TC39 decorators have no parameter decorators, so a gateway
method receives a single `WsContext` instead of `@MessageBody()` /
`@ConnectedSocket()` parameters.

```ts
import {
  type CanActivate,
  type ExecutionContext,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  UseGuards,
  WebSocketGateway,
  WebSocketServer,
  type WsContext,
  WsException,
  type WsResponse,
} from "@denorid/core";
import { Injectable } from "@denorid/injector";
import { z } from "zod";

// Server and client types depend on the WebSocket adapter in use:
// `WsServer` / `WsClient` from `@denorid/platform-hono` (native, default) or
// `Server` / `Socket` from `@denorid/platform-socket-io`.
type Server = unknown;
type Client = unknown;

const message = z.object({ text: z.string() });

@Injectable()
class AuthGuard implements CanActivate {
  public canActivate(ctx: ExecutionContext): boolean {
    const client = ctx.switchToWs().getClient<Client>();
    return client !== undefined;
  }
}

@WebSocketGateway({ path: "/chat" })
export class ChatGateway
  implements
    OnGatewayInit<Server>,
    OnGatewayConnection<Client>,
    OnGatewayDisconnect<Client> {
  @WebSocketServer()
  public server!: Server;

  public afterInit(server: Server): void {}

  public handleConnection(client: Client, ...args: unknown[]): void {}

  public handleDisconnect(client: Client): void {}

  // Sent back as reply (acknowledgement) to the message.
  @SubscribeMessage("ping")
  public ping(): string {
    return "pong";
  }

  // A WsResponse is sent to the client as event "message".
  @SubscribeMessage("message")
  @MessageBody(message)
  @UseGuards(AuthGuard)
  public onMessage(
    ctx: WsContext<typeof message, Client>,
  ): WsResponse<string> {
    if (ctx.data.text.length === 0) {
      throw new WsException("Empty message");
    }

    return { event: "message", data: ctx.data.text };
  }
}
```

Add gateways to the `providers` of a module. Like controllers, a gateway of an
imported module must also be listed in the module's `exports`.

### Gateway methods

- `WsContext` holds the `event`, the `data` (parsed by the `@MessageBody()`
  schema when there is one), the `client` and a `contextId`. Every message runs
  in its own request scope.
- The return value is delivered by the adapter: `undefined` sends nothing, a
  `WsResponse` (`{ event, data }`) is sent as that event, anything else is sent
  as reply to the message.
- `@MessageBody(schema)` validates the payload with a Zod schema. Invalid
  payloads fail with `{ status: "error", message: string[] }`.
- `@UseGuards()` works on gateways and their methods; guards set via
  `app.useGlobalGuards()` apply as well. They run global, class, method and
  receive a `WsExecutionContext` (`ctx.switchToWs()` gives the client, the data
  and the event). A denied message fails with `"Forbidden resource"`.
- Errors are passed to the `@Catch()` exception filters. When a filter handles
  the error, its result is delivered like a return value. Otherwise the client
  receives the payload of a thrown `WsException` (`{ status: "error", message }`
  for string messages) or
  `{ status: "error", message: "Internal server error" }` for any other error,
  as event `"exception"`.

### Lifecycle hooks

- `afterInit(server)` runs once the server was created and the
  `@WebSocketServer()` fields were assigned. Its errors fail the application
  start.
- `handleConnection(client, ...args)` and `handleDisconnect(client)` run for
  every client. Their errors are logged.

### Adapters

`HonoAdapter` from `@denorid/platform-hono` brings a native WebSocket adapter,
used by default: plain WebSockets with a JSON `{ event, data }` protocol,
`WsServer` / `WsClient` with rooms and broadcasts. Gateways sharing a `path`
share one server. For socket.io, use `@denorid/platform-socket-io`:

```ts
import { DenoridFactory } from "@denorid/core";
import { HonoAdapter } from "@denorid/platform-hono";
import { SocketIoAdapter } from "@denorid/platform-socket-io";

const app = await DenoridFactory.create(AppModule, new HonoAdapter());

app.useWebSocketAdapter(new SocketIoAdapter(app));
app.listen();
```

Custom transports implement the `WebSocketAdapter` interface. An HTTP adapter
without a default WebSocket adapter requires `app.useWebSocketAdapter()` once a
gateway exists; the application fails to start otherwise.
