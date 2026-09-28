<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  OpenAPI 3.2 documentation for Denorid - generated from the routes and their
  zod schemas, served with Swagger UI.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/openapi">
    <img src="https://jsr.io/badges/@denorid/openapi" alt="Denorid openapi version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/openapi
```

## Quick Start

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Params,
  Post,
  Query,
  type RequestContext,
  StatusCode,
} from "@denorid/core";
import { Module } from "@denorid/injector";
import { ApiResponse, ApiTags, OpenApiModule } from "@denorid/openapi";
import { z } from "zod";

const Thread = z.object({ id: z.uuid(), title: z.string() })
  .meta({ id: "Thread" });
const CreateThread = z.object({ title: z.string().min(1) })
  .meta({ id: "CreateThread" });
const ListThreads = z.object({
  limit: z.coerce.number().int().max(100).default(20),
  cursor: z.string().optional().describe("Cursor of the previous page"),
});
const ThreadParams = z.object({ id: z.uuid() });

@ApiTags("threads")
@Controller("/threads")
class ThreadController {
  @Get()
  @Query(ListThreads)
  @ApiResponse(StatusCode.Ok, { schema: z.array(Thread) })
  public list(ctx: RequestContext): Promise<z.infer<typeof Thread>[]> {
    const { limit, cursor } = ctx.validated(ListThreads);
  }

  @Get("/:id")
  @Params(ThreadParams)
  @ApiResponse(StatusCode.Ok, { schema: Thread })
  @ApiResponse(StatusCode.NotFound)
  public find(ctx: RequestContext): Promise<z.infer<typeof Thread>> {
    const { id } = ctx.validated(ThreadParams);
  }

  @Post()
  @Body(CreateThread)
  @HttpCode(StatusCode.Created)
  @ApiResponse(StatusCode.Created, { schema: Thread })
  public create(
    ctx: RequestContext<typeof CreateThread>,
  ): Promise<z.infer<typeof Thread>> {}
}

@Module({
  imports: [
    OpenApiModule.forRoot({
      document: { info: { title: "Forum API", version: "1.0.0" } },
    }),
  ],
  providers: [ThreadController],
})
class AppModule {}
```

Swagger UI is served at `GET /docs` and the document at
`GET /docs/openapi.json`. Both are relative to the application base path, like
every controller: with `basePath: "/api"` they move to `/api/docs`.

## What is generated

Everything the framework already knows ends up in the document:

| Source                       | Document                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| Controller and route paths   | Paths, including the base path; `:id` becomes `{id}`                                |
| `@Get()`, `@Post()`, ...     | Operations                                                                          |
| `@Params(schema)`            | Path parameters (without it, strings with the `{pattern}`)                          |
| `@Query(schema)`             | Query parameters, one per property (other schemas: one `querystring` parameter)     |
| `@RequestHeaders(schema)`    | Header parameters, one per property (not `Accept`, `Content-Type`, `Authorization`) |
| `@Body(schema)`              | `application/json` request body                                                     |
| `@Form(schema)`              | `multipart/form-data` and url-encoded request body                                  |
| `@HttpCode()`                | Success response (`200` without it)                                                 |
| Any input schema             | `400 Bad Request` (failed validation)                                               |
| `@UseGuards()`, global guard | `403 Forbidden` and the `@ApiSecurity()` schemes of the guards (see below)          |
| `@Controller({ host })`      | Operation `servers`: `//api.example.com`; a `{host}` variable for a RegExp          |

Request schemas are documented as their input (what they accept), response
schemas as their output (what parsing returns, `z.infer`). Descriptions and
other fields set with `.describe()` and `.meta()` are kept.

Operations get the id `<Controller>_<method>`, e.g. `ThreadController_find`. A
route with several paths (`@Get(["/a", "/b"])`, optional parameters such as
`/:id?`) gets one operation per path, the later ones numbered `_2`, `_3`.

## Decorators

For what the framework cannot know:

| Decorator                               | Applies to               | Purpose                                 |
| --------------------------------------- | ------------------------ | --------------------------------------- |
| `@ApiTags(...tags)`                     | Controller, route        | Groups operations                       |
| `@ApiOperation({ summary, ... })`       | Route                    | Summary, description, operation id, ... |
| `@ApiResponse(status, { schema, ... })` | Guard, controller, route | Documents a response and its body       |
| `@ApiSecurity(...schemes)`              | Guard, controller, route | Security requirements                   |
| `@ApiExclude()`                         | Guard, controller, route | Leaves routes or a guard out            |

TypeScript types do not exist at runtime, so response bodies are documented with
`@ApiResponse()`. A controller-level `@ApiResponse()` applies to all of its
routes, a route-level one with the same status replaces it.

The media type of a response defaults to how the adapter sends the handler
result: `text/plain` for string, number and boolean schemas, `application/json`
otherwise. Set `contentType` for other formats. Raw request bodies the route
reads itself can be documented with `@ApiOperation({ requestBody })`.

## Guard responses

A route running a guard (globally, on its controller or on the route) is
documented with `403 Forbidden`, the response of a guard returning `false`. A
guard that throws its own exceptions documents them with `@ApiResponse()`
instead; a guard that never denies a request is left out with `@ApiExclude()`:

```ts
@ApiSecurity("bearer")
@ApiResponse(StatusCode.Unauthorized)
@Injectable()
class SessionGuard implements CanActivate {
  public canActivate(): boolean {
    throw new UnauthorizedException();
  }
}

@ApiResponse(StatusCode.TooManyRequests)
@Injectable()
class WriteRateLimitGuard implements CanActivate {}

@ApiExclude()
@Injectable()
class OptionalSessionGuard implements CanActivate {}
```

- Routes behind `SessionGuard` get `401`, routes behind `WriteRateLimitGuard`
  get `429`, routes behind `OptionalSessionGuard` get neither `403` nor its
  security requirements.
- `403` is still added when another guard of the route documents no response.
- A controller or route response with the same status replaces the guard
  response; among the guards of a route, the later one wins. Guard responses do
  not replace the success response of the route.

## Streamed responses

OpenAPI 3.2 describes streams item by item. `itemSchema` documents every item of
a sequential media type, `application/jsonl` unless `contentType` says otherwise
(`application/x-ndjson`, `application/json-seq`, ...):

```ts
@Get("/logs")
@ApiResponse(StatusCode.Ok, { itemSchema: LogEntry })
public logs(): Response {}
```

`events` documents a stream of server-sent events (`text/event-stream`) by event
name. Each schema describes the `data` of its event: string schemas as sent,
other schemas as JSON (`contentMediaType` and `contentSchema`). The `message`
event also covers events sent without an `event` field, which browsers dispatch
as `message`.

```ts
@Get("/chat")
@ApiResponse(StatusCode.Ok, {
  events: {
    message: ChatMessage,
    typing: z.object({ userId: z.uuid() }),
    ping: z.string(),
  },
})
public chat(): Response {}
```

## Schemas and components

A zod schema with an `id` becomes an entry of `components.schemas` and is
referenced everywhere it is used:

```ts
const User = z.object({
  id: z.uuid(),
  role: z.enum(["admin", "user"]).default("user"),
}).meta({ id: "User", description: "A forum member" });
```

When the same schema is used for a request and a response and the two differ
(here `role` is optional in the input and always present in the output), the
input keeps the id and the output gets `Output` appended: `User` and
`UserOutput`. Ids must be unique; two different schemas with the same id throw
when the document is created.

Recursive schemas without `id` become `Schema1`, `Schema2`, ...; give them an
`id` for a readable name. `z.date()` is documented as a `date-time` string, the
way JSON sends it.

## Security

Define the schemes in the document options and mark the guards that enforce
them. Every route running the guard, globally, on its controller or on the
route, requires the scheme:

```ts
@ApiSecurity("bearer")
@Injectable()
class AuthGuard implements CanActivate {
  public canActivate(ctx: ExecutionContext): boolean {}
}

OpenApiModule.forRoot({
  document: {
    info: { title: "Forum API", version: "1.0.0" },
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  },
});
```

- Every `@ApiSecurity()` (of each guard, the controller and the route) is
  required. The arguments of one decorator are alternatives:
  `@ApiSecurity("bearer", "apiKey")` accepts either.
- Scopes: `@ApiSecurity({ oauth: ["read"] })`.
- `@ApiSecurity()` without arguments documents a route, or all routes of a
  controller, as public, e.g. a login route behind a global authentication
  guard.
- A scheme name that `components.securitySchemes` does not define throws when
  the document is created. Keys containing `:`, `#` or `/` are security scheme
  URIs (OpenAPI 3.2) and are not checked.

## Options

| Option     | Default  | Description                                                                         |
| ---------- | -------- | ----------------------------------------------------------------------------------- |
| `path`     | `"docs"` | Path of Swagger UI; the document is served at `<path>/openapi.json`.                |
| `document` | -        | Top-level fields: `info` (required), `servers`, `tags`, `security`, `components`... |
| `ui`       | `true`   | Serves Swagger UI. The page loads Swagger UI pinned from jsDelivr, with SRI hashes. |

`forRootAsync()` creates the document fields with a factory; `path` and `ui`
define routes and stay static:

```ts
OpenApiModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    info: { title: "Forum API", version: config.get("VERSION") },
  }),
});
```

## Writing the document to a file

The document is created from the routes the controllers declare, which are known
as soon as the application is created: `app.init()` and the
`onApplicationBootstrap` hooks (e.g. broker connections) are not needed. Add the
global guards before creating the document:

```ts
await using app = await DenoridFactory.create(AppModule, new HonoAdapter(), {
  basePath: "/api",
});
app.useGlobalGuards(new AuthGuard());

const openApi = await app.get(OpenApiService, { strict: false });
await Deno.writeTextFile(
  "openapi.json",
  JSON.stringify(openApi.getDocument(), null, 2),
);
```

Creating the application creates its providers. To replace providers that need a
real environment, compile a testing module with `useCoreGlobals()` instead
(`overrideProvider()`); its routes have no base path and no global guards:

```ts
await using module = await Test.createTestingModule({ imports: [AppModule] })
  .useCoreGlobals()
  .compile();

const document = (await module.get(OpenApiService)).getDocument();
```

## Limitations

- A controller `host` is documented as operation `servers` relative to the
  scheme of the documentation page (`//api.example.com`). A RegExp host cannot
  be written as a URL: it becomes a `//{host}` server whose variable has to be
  filled in. Controllers with an empty `host` list serve nothing and are left
  out.
- `@RequestHeaders()` schemas that are not objects (e.g. `z.record()`) cannot be
  split into header parameters and are not documented.
- Path segments are read in the `:name`, `:name{pattern}` and `:name?` syntax;
  wildcards (`*`) are kept as literal segments.
- Only the first route registered for a method and path is documented, since it
  answers the requests.

## License

The [@denorid/openapi](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
