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

## Application lifecycle

- `app.init()` registers the `@Catch()` exception filters, then runs the
  `onApplicationBootstrap` hooks (HTTP applications also set up the routes and
  WebSocket gateways). It runs once: concurrent and later calls share the same
  promise. When it fails, the next call starts over.
- `app.listen()` initializes the application first. An HTTP application starts
  its server only after the initialization succeeded; a failed initialization is
  rethrown as an unhandled rejection. A microservice application
  (`DenoridFactory.create(AppModule, server)`) returns the server's `listen()`
  promise; when the server fails to start it is closed and `listen()` can be
  called again.
- `app.startAllMicroservices()` starts the servers added with
  `app.connectMicroservice()`. A server whose `listen()` rejects right away is
  closed together with the servers started before it and the error is rethrown.
  A transport's `listen()` usually settles only when the server stops, so later
  failures (a port in use, a refused broker connection) are logged and close the
  failed server.
- `app.close()` waits for a running initialization, stops the servers and closes
  the injector context, even when `init()` was never called. Nothing is started
  once it was called; later calls return the same promise.
- Applications are `AsyncDisposable`:
  `await using app = await
  DenoridFactory.create(AppModule)` closes the
  application at the end of the block. Closing the injector context runs
  `onBeforeApplicationShutdown`, `onModuleDestroy` and `onApplicationShutdown`,
  then disposes every singleton the container created (class and factory
  providers, not `useValue`) that implements `[Symbol.asyncDispose]()` or
  `[Symbol.dispose]()`, newest first. Release connections and pools there: other
  providers can still use them in their shutdown hooks.

```ts
@Injectable()
class Database implements AsyncDisposable {
  private readonly pool = createPool();

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.pool.end();
  }
}

{
  await using app = await DenoridFactory.create(AppModule);
  await app.init();
  // ...
} // Database pool closed here
```

## Exception filters

A filter registered with `@Catch(SomeError)` handles `SomeError` and its
subclasses. For an error, only the filters of its most specific class that has
filters run: with `@Catch(HttpException)` and `@Catch(Error)`, a
`NotFoundException` goes to the first one and a `TypeError` to the second.

## Testing

```ts
import { Test } from "@denorid/core/testing";

const module = await Test.createTestingModule({ imports: [UsersModule] })
  .overrideProvider(UsersRepository)
  .useValue({ find: () => [] })
  .compile();
```

- `overrideProvider()` replaces the provider wherever its token is declared,
  including imported and global modules, the core globals of `useCoreGlobals()`
  and the mocks of `useMocker()`.
- `useMocker()` only mocks field dependencies of the testing module's providers
  that nothing provides; the exports of imported modules and globals are kept.
- `module.get(token, { contextId })` and `module.getByTag(tags, { contextId })`
  return one transient instance per context, like the application does.

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

Add gateways to the `providers` of any module of the application; a gateway of
an imported module does not need to be exported.

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
  and the event). A denied message fails with `"Forbidden resource"`. Guard
  classes are resolved through dependency injection from any module.
- An event can be handled by one method per server. Gateways with equal options
  (e.g. the same `path`) share a server, so they cannot subscribe to the same
  event; the application fails to start otherwise.
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
