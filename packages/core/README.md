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
  (`DenoridFactory.create(AppModule, server)`) resolves once the server accepts
  messages; when the server fails to start it is closed and `listen()` can be
  called again.
- `app.startAllMicroservices()` starts the servers added with
  `app.connectMicroservice()` one after another and resolves once all of them
  accept messages. When one fails to start (a port in use, a refused broker
  connection), it is closed together with the servers started before it and the
  error is rethrown. A server that is running handles later failures itself.
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

## Request validation

`@Body()` (JSON), `@Form()` (form data), `@Query()`, `@Params()` and
`@RequestHeaders()` validate the inputs of a route with Zod schemas. Validation
runs after the guards allowed the request and before the handler: the path
parameters first, then the query string, then the headers, then the body, which
is only read when the route declares `@Body()` or `@Form()`. An invalid input
answers `400 Bad Request` with one message per issue
(`"limit: Too big: expected number to be <=100"`); a body that cannot be parsed
answers `400` with `"Malformed request body"`.

```ts
import {
  Body,
  Controller,
  Get,
  Params,
  Post,
  Query,
  type RequestContext,
  RequestHeaders,
} from "@denorid/core";
import { z } from "zod";

const ThreadParams = z.object({ id: z.uuid() });
const ListQuery = z.object({
  limit: z.coerce.number().int().max(100).default(20),
  tags: z.array(z.string()).optional(),
});
const TenantHeaders = z.object({ "x-tenant-id": z.uuid() });
const CreateThread = z.object({ title: z.string().min(1) });

@Controller("threads")
export class ThreadController {
  @Get()
  @Query(ListQuery)
  @RequestHeaders(TenantHeaders)
  public list(ctx: RequestContext): unknown {
    const { limit, tags } = ctx.validated(ListQuery);
    const tenant = ctx.validated(TenantHeaders)["x-tenant-id"];
    return { limit, tags, tenant };
  }

  @Get(":id")
  @Params(ThreadParams)
  public get(ctx: RequestContext): unknown {
    return { id: ctx.validated(ThreadParams).id };
  }

  @Post()
  @Body(CreateThread)
  public create(ctx: RequestContext<typeof CreateThread>): unknown {
    return { title: ctx.dto?.title };
  }
}
```

- `ctx.validated(schema)` returns the parsed value (defaults, coercions and
  transforms applied) of a schema declared on the route; it throws for any other
  schema. The parsed body is also available as `ctx.dto`.
- Path parameters, query values and headers are strings: use `z.coerce` for
  numbers, booleans and dates.
- Query string: a key given once is passed as a string, a repeated key as a
  `string[]`. A key whose schema accepts an array (`z.array()`, `z.tuple()` or
  `z.set()`, also inside `.optional()`, `.default()`, unions, ...) is always a
  `string[]`, so `?tags=a` gives `["a"]`. A repeated key whose schema expects a
  single value fails: `?limit=1&limit=2` answers `400` instead of using one of
  the values.
- Headers: the schema receives every header of the request with its name in
  lowercase, so its keys must be lowercase (`"x-tenant-id"`), whatever casing
  the client sent. A header sent several times arrives as one value joined with
  `,`. `z.object()` strips the headers it does not declare. The decorator is
  named `@RequestHeaders()` rather than `@Headers()` so it does not shadow the
  global `Headers` class.
- Refinements may be async.

## Response headers

Guards and handlers add response headers through `ctx.responseHeaders` (a
standard `Headers` object) and keep returning their typed result. With an `ETag`
or `Last-Modified` header, a successful `GET` or `HEAD` request whose client
copy is current is answered with `304 Not Modified` and no body.

```ts
@Get(":threadId")
public async page(ctx: RequestContext): Promise<ThreadPage> {
  const page = await this.threads.page(ctx.param("threadId")!);

  ctx.responseHeaders.set("Cache-Control", "public, no-cache");
  ctx.responseHeaders.set("ETag", `"${page.revision}"`);
  ctx.responseHeaders.set("Vary", "Accept-Language");

  return page;
}
```

- The client copy is current when an entity tag in `If-None-Match` matches the
  `ETag` (weak comparison, `*` matches any) or, without `If-None-Match`, when
  `If-Modified-Since` is not older than `Last-Modified`. Other methods and
  statuses outside `2xx` ignore the conditional headers.
- The `304` carries the same headers. Routes that set neither `ETag` nor
  `Last-Modified` never answer `304`.
- The headers replace the ones the adapter sets itself, e.g. `Content-Type`.
- A `Response` returned by the handler is sent as is, without these headers.
- Error responses never carry them, so a failed request is not cached with the
  `Cache-Control` or `ETag` of the result.

## Registered routes

`HttpRoutes` lists the routes of the HTTP application, e.g. to generate API
documentation. It is injectable in every application created by `DenoridFactory`
(and in testing modules with `useCoreGlobals()`). The routes are listed as soon
as the application is created, so `app.init()` and the `onApplicationBootstrap`
hooks are not needed: the list holds the routes the controllers declare, with
the base path and the global guards added so far. Once `app.init()` registered
the routes, it holds the registered ones. It is empty in applications without
HTTP adapter. In testing modules, it lists the routes of the testing module's
controllers (imports included) without base path and global guards.

```ts
import { HttpMethod, HttpRoutes } from "@denorid/core";
import { Inject, Injectable } from "@denorid/injector";

@Injectable()
export class RouteLister {
  @Inject(HttpRoutes)
  private readonly routes!: HttpRoutes;

  public print(): void {
    for (const { method, path, controller } of this.routes.list()) {
      console.log(HttpMethod[method], path, controller.name);
    }
  }
}
```

Every entry holds the `method`, the full `path` (base path, controller path and
route path, e.g. `/api/threads/:id`; a path array gives one entry per path), the
`controller` class, the `host` restriction of the controller (only present for
`@Controller({ host })`: a string, a RegExp or an array of both), the route
`metadata` (including the `@Body()`, `@Form()`, `@Query()`, `@Params()` and
`@RequestHeaders()` schemas) and the `guards` (global, controller and method
guards, without duplicates).

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
