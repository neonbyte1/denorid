import type {
  CanActivateFn,
  ControllerOptions,
  CorsOptions,
  ExceptionHandler,
  HttpController,
  HttpRouteFn,
  RequestMappingMetadata,
} from "@denorid/core";
import {
  BadRequestException,
  HttpMethod,
  InternalServerErrorException,
  NotFoundException,
  StatusCode,
} from "@denorid/core";
import type { InjectorContext, Type } from "@denorid/injector";
import { type Context, Hono } from "@hono/hono";
import {
  assertEquals,
  assertInstanceOf,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import type { HonoAdapterOptions } from "./adapter.ts";
import { HonoControllerMapping } from "./controller_mapping.ts";
import { HonoRequestContext } from "./request_context.ts";

describe(HonoControllerMapping.name, () => {
  // todo: maybe export them?
  const CONTROLLER_METADATA = Symbol.for("denorid.controller");
  const CONTROLLER_REQUEST_MAPPING = Symbol.for("denorid.request_mapping");
  type RouteHandler = (c: Context) => Promise<Response>;

  interface CapturedRoute {
    method: string;
    path: string;
    handler: RouteHandler;
  }

  function makeHonoApp(): { app: Hono; routes: CapturedRoute[] } {
    const routes: CapturedRoute[] = [];
    const app = {
      on: (method: string, path: string, handler: RouteHandler) => {
        routes.push({ method, path, handler });
      },
    } as unknown as Hono;
    return { app, routes };
  }

  function makeHonoContext(opts?: {
    requestId?: string;
    jsonBody?: unknown;
    formBody?: unknown;
    jsonThrows?: boolean;
    formThrows?: boolean;
  }) {
    const requestId = opts?.requestId;
    const addValidatedDataSpy = spy((_type: string, _data: unknown) => {});
    const bodySpy = spy((_data: null, status: number) =>
      new Response(null, { status })
    );
    const textSpy = spy((text: string, status: number) =>
      new Response(text, { status })
    );
    const jsonSpy = spy((data: unknown, status: number) =>
      new Response(JSON.stringify(data), { status })
    );

    const ctx = {
      req: {
        url: "http://localhost/test",
        method: "GET",
        header: (key?: string) =>
          key === "x-request-id" ? requestId : undefined,
        json: opts?.jsonThrows
          ? () => Promise.reject(new SyntaxError("bad json"))
          : () => Promise.resolve(opts?.jsonBody ?? {}),
        parseBody: opts?.formThrows
          ? () => Promise.reject(new Error("bad form"))
          : () => Promise.resolve(opts?.formBody ?? {}),
        addValidatedData: addValidatedDataSpy,
      },
      body: bodySpy,
      text: textSpy,
      json: jsonSpy,
    } as unknown as Context;

    return { ctx, addValidatedDataSpy, bodySpy, textSpy, jsonSpy };
  }

  function makeInjectorContext(opts: {
    tokens?: Type[];
    controller?: HttpController;
    instances?: Map<Type, HttpController>;
  }) {
    const runInRequestScopeAsync = spy(
      (_id: string, fn: () => Promise<unknown>) => fn(),
    );
    const clearContext = spy((_id: string) => {});
    const moduleRefGet = spy((token: Type, _options?: unknown) =>
      Promise.resolve(opts.instances?.get(token) ?? opts.controller ?? {})
    );

    const injectorCtx = {
      container: {
        getTokensByTag: () => opts.tokens ?? [...opts.instances?.keys() ?? []],
      },
      runInRequestScopeAsync,
      clearContext,
      getHostModuleRef: () => ({
        get: moduleRefGet,
      }),
    } as unknown as InjectorContext;

    return {
      injectorCtx,
      runInRequestScopeAsync,
      resolveInternal: moduleRefGet,
    };
  }

  function makeExceptionHandler(returnValue: unknown = undefined) {
    const handleSpy = spy(() => Promise.resolve(returnValue));
    const exHandler = {
      handle: handleSpy,
      register: spy(async () => {}),
      canHandle: spy(() => false),
    } as unknown as ExceptionHandler;
    return { exHandler, handleSpy };
  }

  function setControllerMetadata(
    target: Type,
    meta: ControllerOptions,
    routes?: RequestMappingMetadata[],
  ): void {
    Object.defineProperty(target, Symbol.metadata, {
      value: {
        [CONTROLLER_METADATA]: meta,
        ...(routes !== undefined
          ? { [CONTROLLER_REQUEST_MAPPING]: routes }
          : {}),
      },
      writable: true,
      configurable: true,
    });
  }

  async function registerAndCapture(opts: {
    route: RequestMappingMetadata;
    controller: HttpController;
    exHandler?: ExceptionHandler;
    basePath?: string;
    controllerPath?: string;
    globalGuards?: CanActivateFn[];
    cors?: boolean | CorsOptions;
  }) {
    class FakeController {}
    setControllerMetadata(FakeController, {
      path: opts.controllerPath ?? "/test",
    }, [{ method: HttpMethod.GET, ...opts.route }]);

    const { app, routes: capturedRoutes } = makeHonoApp();
    const { injectorCtx, runInRequestScopeAsync, resolveInternal } =
      makeInjectorContext({
        tokens: [FakeController],
        controller: opts.controller,
      });

    const mapping = new HonoControllerMapping(
      app,
      {
        ctx: injectorCtx,
        exceptionHandler: opts.exHandler ?? makeExceptionHandler().exHandler,
        globalGuards: opts.globalGuards ?? [],
        cors: opts.cors,
      },
    );

    await mapping.register(opts.basePath);

    return {
      capturedRoutes,
      runInRequestScopeAsync,
      resolveInternal,
      mapping,
    };
  }

  interface ControllerSpec extends ControllerOptions {
    routes: RequestMappingMetadata[];
    instance: HttpController;
  }

  /**
   * Registers controllers on a real Hono app, so routing, CORS, the static
   * files handler and the client address resolution run end to end.
   */
  async function createApp(
    controllers: ControllerSpec[],
    opts: {
      adapterOptions?: HonoAdapterOptions;
      basePath?: string;
      cors?: boolean | CorsOptions;
      exHandler?: ExceptionHandler;
    } = {},
  ): Promise<Hono> {
    const instances = new Map<Type, HttpController>();

    for (const { routes, instance, ...options } of controllers) {
      class FakeController {}
      setControllerMetadata(FakeController, options, routes);
      instances.set(FakeController, instance);
    }

    const app = new Hono();
    const { injectorCtx } = makeInjectorContext({ instances });
    const mapping = new HonoControllerMapping(
      app,
      {
        ctx: injectorCtx,
        exceptionHandler: opts.exHandler ?? makeExceptionHandler().exHandler,
        globalGuards: [],
        cors: opts.cors,
      },
      opts.adapterOptions,
    );

    await mapping.register(opts.basePath);

    return app;
  }

  /** Registers one `GET /test` controller route on a real Hono app. */
  function registerOnHono(opts: {
    route: RequestMappingMetadata;
    controller: HttpController;
    adapterOptions?: HonoAdapterOptions;
    basePath?: string;
  }): Promise<Hono> {
    return createApp([{
      path: "/test",
      routes: [{ method: HttpMethod.GET, ...opts.route }],
      instance: opts.controller,
    }], opts);
  }

  async function makeStaticRoot(
    files: Record<string, string>,
  ): Promise<AsyncDisposable & { path: string }> {
    const path = await Deno.makeTempDir();

    for (const [name, content] of Object.entries(files)) {
      await Deno.mkdir(dirname(join(path, name)), { recursive: true });
      await Deno.writeTextFile(join(path, name), content);
    }

    return {
      path,
      [Symbol.asyncDispose]: () => Deno.remove(path, { recursive: true }),
    };
  }

  async function fetchText(app: Hono, path: string): Promise<[number, string]> {
    const response = await app.request(path);

    return [response.status, await response.text()];
  }

  describe("register()", () => {
    it("lets controller routes take precedence over static files", async () => {
      await using root = await makeStaticRoot({
        "test/hello": "from file",
        "robots.txt": "from file",
      });
      const app = await registerOnHono({
        route: { name: "hello", path: "hello" },
        controller: { hello: () => "from controller" },
        adapterOptions: { staticFiles: { root: root.path } },
      });

      assertEquals(await fetchText(app, "/test/hello"), [
        200,
        "from controller",
      ]);
      assertEquals(await fetchText(app, "/robots.txt"), [200, "from file"]);
    });

    it("never serves static files below the base path", async () => {
      await using root = await makeStaticRoot({
        "api/robots.txt": "hidden",
        "robots.txt": "public",
      });
      const app = await registerOnHono({
        route: { name: "hello", path: "hello" },
        controller: { hello: () => "from controller" },
        adapterOptions: { staticFiles: { root: root.path } },
        basePath: "/api/",
      });

      assertEquals(
        await fetchText(app, "/api/test/hello"),
        [200, "from controller"],
      );
      assertEquals((await app.request("/api/robots.txt")).status, 404);
      assertEquals(await fetchText(app, "/robots.txt"), [200, "public"]);
    });

    it("rejects when the static files root is missing", async () => {
      await using root = await makeStaticRoot({});

      await assertRejects(
        () =>
          registerOnHono({
            route: { name: "hello" },
            controller: { hello: () => null },
            adapterOptions: { staticFiles: { root: join(root.path, "dist") } },
          }),
        Error,
        "is not a directory",
      );
    });

    it("resolves client addresses with the client IP options", async () => {
      const app = await registerOnHono({
        route: { name: "ip", path: "ip" },
        controller: { ip: (ctx) => ctx.ip },
        adapterOptions: { clientIp: { trustProxy: ["loopback"] } },
      });
      const response = await app.request(
        "/test/ip",
        { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } },
        { remoteAddr: { hostname: "127.0.0.1" } },
      );

      assertEquals(await response.text(), "203.0.113.9");
    });
  });

  describe("registerRoute()", () => {
    it("registers a GET route when method is HttpMethod.GET", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "index", method: HttpMethod.GET },
        controller: { index: () => null },
      });

      assertEquals(capturedRoutes[0].method, "GET");
    });

    it("registers a POST route when method is HttpMethod.POST", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "create", method: HttpMethod.POST },
        controller: { create: () => null },
      });

      assertEquals(capturedRoutes[0].method, "POST");
    });

    it("registers a DELETE route when method is HttpMethod.DELETE", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "remove", method: HttpMethod.DELETE },
        controller: { remove: () => null },
      });

      assertEquals(capturedRoutes[0].method, "DELETE");
    });

    it("builds the full path by joining base path, controller path, and route path", async () => {
      class FakeController {}
      setControllerMetadata(FakeController, { path: "/users" }, [
        { name: "get", path: ":id", method: HttpMethod.GET },
      ]);

      const { app, routes } = makeHonoApp();
      const { injectorCtx } = makeInjectorContext({
        tokens: [FakeController],
        controller: { get: () => null },
      });
      const mapping = new HonoControllerMapping(
        app,
        {
          ctx: injectorCtx,
          exceptionHandler: makeExceptionHandler().exHandler,
          globalGuards: [],
          cors: undefined,
        },
      );

      await mapping.register("v1");

      assertEquals(routes[0].path, "/v1/users/:id");
    });

    it("defaults to the controller base path when route path is undefined", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "list" },
        controller: { list: () => [] },
        controllerPath: "/items",
      });

      assertEquals(capturedRoutes[0].path, "/items");
    });

    it("registers one handler per declared route", async () => {
      class FakeController {}
      setControllerMetadata(FakeController, { path: "/a" }, [
        { name: "r1", path: "one", method: HttpMethod.GET },
        { name: "r2", path: "two", method: HttpMethod.GET },
        { name: "r3", path: "three", method: HttpMethod.GET },
      ]);

      const { app, routes } = makeHonoApp();
      const { injectorCtx } = makeInjectorContext({
        tokens: [FakeController],
        controller: { r1: () => null, r2: () => null, r3: () => null },
      });
      const mapping = new HonoControllerMapping(
        app,
        {
          ctx: injectorCtx,
          exceptionHandler: makeExceptionHandler().exHandler,
          globalGuards: [],
          cors: undefined,
        },
      );

      await mapping.register();

      assertEquals(routes.length, 3);
    });
  });

  describe("route handler - request scope", () => {
    it("uses a fresh UUID per request as scope id, never the x-request-id header", async () => {
      const { capturedRoutes, runInRequestScopeAsync, resolveInternal } =
        await registerAndCapture({
          route: { name: "index" },
          controller: { index: () => null },
        });

      await capturedRoutes[0].handler(
        makeHonoContext({ requestId: "shared-id" }).ctx,
      );
      await capturedRoutes[0].handler(
        makeHonoContext({ requestId: "shared-id" }).ctx,
      );

      const [first, second] = runInRequestScopeAsync.calls.map(({ args }) =>
        args[0]
      );
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

      assertMatch(first, uuid);
      assertMatch(second, uuid);
      assertNotEquals(first, second);
      assertEquals(resolveInternal.calls[0].args[1], {
        contextId: first,
        strict: false,
      });
    });

    it("calls runInRequestScopeAsync exactly once per request", async () => {
      const { capturedRoutes, runInRequestScopeAsync } =
        await registerAndCapture({
          route: { name: "index" },
          controller: { index: () => null },
        });

      const { ctx } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(runInRequestScopeAsync, 1);
    });
  });

  describe("route handler - controller invocation", () => {
    it("resolves the controller class from the injector context", async () => {
      const { capturedRoutes, resolveInternal } = await registerAndCapture({
        route: { name: "index" },
        controller: { index: () => null },
      });

      const { ctx } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(resolveInternal, 1);
    });

    it("calls the named method on the resolved controller", async () => {
      const indexSpy = spy(() => "ok");
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "index" },
        controller: { index: indexSpy },
      });

      const { ctx } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(indexSpy, 1);
    });

    it("passes a HonoRequestContext as the first argument to the handler", async () => {
      let receivedArg: unknown;
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "index" },
        controller: {
          index: (arg) => {
            receivedArg = arg;
            return null;
          },
        },
      });

      const { ctx } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertInstanceOf(receivedArg, HonoRequestContext);
    });
  });

  describe("validateRequest()", () => {
    it("passes undefined as dto when the route has no validation", async () => {
      let capturedDto: unknown = "sentinel";
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "index" },
        controller: {
          index: (ctx) => {
            capturedDto = ctx.dto;
            return null;
          },
        },
      });

      const { ctx } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertEquals(capturedDto, undefined);
    });

    it("calls c.req.json() for json validation type", async () => {
      const schema = z.object({ name: z.string() });
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "create", validation: { type: "json", dto: schema } },
        controller: { create: () => null },
      });

      const jsonSpy = spy(() => Promise.resolve({ name: "Alice" }));
      const { ctx } = makeHonoContext();
      (ctx.req as unknown as Record<string, unknown>).json = jsonSpy;

      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
    });

    it("calls c.req.parseBody() for form validation type", async () => {
      const schema = z.object({ name: z.string() });
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "submit", validation: { type: "form", dto: schema } },
        controller: { submit: () => null },
      });

      const parseBodySpy = spy(() => Promise.resolve({ name: "Bob" }));
      const { ctx } = makeHonoContext();
      (ctx.req as unknown as Record<string, unknown>).parseBody = parseBodySpy;

      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(parseBodySpy, 1);
    });

    it("returns 400 BadRequest when json body cannot be parsed", async () => {
      const schema = z.object({ name: z.string() });
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "create", validation: { type: "json", dto: schema } },
        controller: { create: () => null },
      });

      const { ctx, jsonSpy } = makeHonoContext({ jsonThrows: true });
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
      const [body] = jsonSpy.calls[0].args as [{ message: string }, number];
      assertEquals(body.message, "Malformed request body");
    });

    it("returns 400 BadRequest when form body cannot be parsed", async () => {
      const schema = z.object({ name: z.string() });
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "submit", validation: { type: "form", dto: schema } },
        controller: { submit: () => null },
      });

      const { ctx, jsonSpy } = makeHonoContext({ formThrows: true });
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
      const [body] = jsonSpy.calls[0].args as [{ message: string }, number];
      assertEquals(body.message, "Malformed request body");
    });

    it("returns 400 when dto validation fails (ZodValidationException)", async () => {
      const schema = z.object({ age: z.number() });
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "create", validation: { type: "json", dto: schema } },
        controller: { create: () => null },
      });

      const { ctx, jsonSpy } = makeHonoContext({
        jsonBody: { age: "not-a-number" },
      });
      await capturedRoutes[0].handler(ctx);

      const [, status] = jsonSpy.calls[0].args as [unknown, number];
      assertEquals(status, StatusCode.BadRequest);
    });

    it("calls c.req.addValidatedData with the validated data on success", async () => {
      const schema = z.object({ name: z.string() });
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "create", validation: { type: "json", dto: schema } },
        controller: { create: () => null },
      });

      const { ctx, addValidatedDataSpy } = makeHonoContext({
        jsonBody: { name: "Alice" },
      });
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(addValidatedDataSpy, 1);
      assertSpyCall(addValidatedDataSpy, 0, {
        args: ["json", { name: "Alice" }],
      });
    });

    it("passes the validated dto to the controller method", async () => {
      const schema = z.object({ value: z.number() });
      let capturedDto: unknown;
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "create", validation: { type: "json", dto: schema } },
        controller: {
          create: (ctx) => {
            capturedDto = ctx.dto;
            return null;
          },
        },
      });

      const { ctx } = makeHonoContext({ jsonBody: { value: 42 } });
      await capturedRoutes[0].handler(ctx);

      assertEquals(capturedDto, { value: 42 });
    });
  });

  describe("resolveResponse()", () => {
    it("returns a Response instance from the controller directly", async () => {
      const expected = new Response("direct", { status: 201 });
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "index" },
        controller: { index: () => expected },
      });

      const { ctx, textSpy, jsonSpy } = makeHonoContext();
      const result = await capturedRoutes[0].handler(ctx);

      assertEquals(result, expected);
      assertSpyCalls(textSpy, 0);
      assertSpyCalls(jsonSpy, 0);
    });

    it("returns 204 No Content when controller returns undefined", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "index" },
        controller: { index: () => undefined },
      });

      const { ctx, bodySpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(bodySpy, 1);
      assertSpyCall(bodySpy, 0, { args: [null, StatusCode.NoContent] });
    });

    it("returns 204 No Content when controller returns null", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "index" },
        controller: { index: () => null },
      });

      const { ctx, bodySpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(bodySpy, 1);
      assertSpyCall(bodySpy, 0, { args: [null, StatusCode.NoContent] });
    });

    it("answers empty results with the route statusCode when provided", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "enqueue", statusCode: StatusCode.Accepted },
        controller: { enqueue: () => undefined },
      });

      const { ctx, bodySpy } = makeHonoContext();
      const response = await capturedRoutes[0].handler(ctx);

      assertSpyCall(bodySpy, 0, { args: [null, StatusCode.Accepted] });
      assertEquals(response.status, StatusCode.Accepted);
    });

    it("returns c.text for a string result", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "ping" },
        controller: { ping: () => "pong" },
      });

      const { ctx, textSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(textSpy, 1);
      assertSpyCall(textSpy, 0, { args: ["pong", StatusCode.Ok] });
    });

    it("returns c.text for a number result", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "count" },
        controller: { count: () => 42 },
      });

      const { ctx, textSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(textSpy, 1);
      assertSpyCall(textSpy, 0, { args: ["42", StatusCode.Ok] });
    });

    it("returns c.text for a boolean result", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "flag" },
        controller: { flag: () => true },
      });

      const { ctx, textSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(textSpy, 1);
      assertSpyCall(textSpy, 0, { args: ["true", StatusCode.Ok] });
    });

    it("returns c.text for a bigint result", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "big" },
        controller: { big: () => BigInt(9999) },
      });

      const { ctx, textSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(textSpy, 1);
      assertSpyCall(textSpy, 0, { args: ["9999", StatusCode.Ok] });
    });

    it("returns c.text for a symbol result", async () => {
      const sym = Symbol("hello");
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "sym" },
        controller: { sym: () => sym },
      });

      const { ctx, textSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(textSpy, 1);
      assertSpyCall(textSpy, 0, { args: [String(sym), StatusCode.Ok] });
    });

    it("returns c.json for an object result", async () => {
      const data = { id: 1, name: "Alice" };
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "get" },
        controller: { get: () => data },
      });

      const { ctx, jsonSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
      assertSpyCall(jsonSpy, 0, { args: [data, StatusCode.Ok] });
    });

    it("uses the route statusCode when provided", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "create", statusCode: StatusCode.Created },
        controller: { create: () => ({ id: 99 }) },
      });

      const { ctx, jsonSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
      assertSpyCall(jsonSpy, 0, {
        args: [{ id: 99 }, StatusCode.Created],
      });
    });

    it("defaults to 200 when the route does not specify a statusCode", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "get" },
        controller: { get: () => ({ ok: true }) },
      });

      const { ctx, jsonSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      const [, status] = jsonSpy.calls[0].args as [unknown, number];
      assertEquals(status, StatusCode.Ok);
    });

    it("returns 422 UnprocessableContent when controller returns a function", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "bad" },
        controller: { bad: () => () => {} },
      });

      const { ctx, jsonSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
      const [, status] = jsonSpy.calls[0].args as [unknown, number];
      assertEquals(status, StatusCode.UnprocessableContent);
    });
  });

  describe("handleError()", () => {
    it("returns the Response from exceptionHandler when it handles the error", async () => {
      const customResponse = new Response("handled", { status: 200 });
      const { exHandler } = makeExceptionHandler(customResponse);

      const { capturedRoutes } = await registerAndCapture({
        route: { name: "boom" },
        controller: {
          boom: () => {
            throw new Error("oops");
          },
        },
        exHandler,
      });

      const { ctx } = makeHonoContext();
      const result = await capturedRoutes[0].handler(ctx);

      assertEquals(result, customResponse);
    });

    it("returns c.json with exception body when HttpException is thrown and handler returns undefined", async () => {
      const { exHandler } = makeExceptionHandler(undefined);
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "auth" },
        controller: {
          auth: () => {
            throw new BadRequestException("Invalid input");
          },
        },
        exHandler,
      });

      const { ctx, jsonSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
      const [, status] = jsonSpy.calls[0].args as [unknown, number];
      assertEquals(status, StatusCode.BadRequest);
    });

    it("answers an Error with the standard 500 body, without its message", async () => {
      const { exHandler } = makeExceptionHandler(undefined);
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "crash" },
        controller: {
          crash: () => {
            throw new Error("db password=hunter2");
          },
        },
        exHandler,
      });

      const { ctx, jsonSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCall(jsonSpy, 0, {
        args: [
          new InternalServerErrorException().response,
          StatusCode.InternalServerError,
        ],
      });
    });

    for (
      const [kind, thrown] of [
        ["string", "db password=hunter2"],
        ["object", { secret: "hunter2" }],
      ] as const
    ) {
      it(`answers a thrown ${kind} with the standard 500 body and logs it`, async () => {
        const { exHandler } = makeExceptionHandler(undefined);
        const { capturedRoutes, mapping } = await registerAndCapture({
          route: { name: "crash" },
          controller: {
            crash: () => {
              throw thrown;
            },
          },
          exHandler,
        });
        // Bracket access reaches the protected logger of the mapping.
        using logError = stub(mapping["logger"], "error");

        const { ctx, jsonSpy } = makeHonoContext();
        await capturedRoutes[0].handler(ctx);

        assertSpyCall(jsonSpy, 0, {
          args: [
            new InternalServerErrorException().response,
            StatusCode.InternalServerError,
          ],
        });
        assertSpyCall(logError, 0, { args: [thrown] });
      });
    }

    describe("exception filter results", () => {
      interface Answer {
        response: Response;
        /** Arguments of every `c.json()` call. */
        json: unknown[][];
        /** Arguments of every `c.text()` call. */
        text: unknown[][];
      }

      async function answer(
        thrown: Error,
        filterResult: unknown,
      ): Promise<Answer> {
        const { capturedRoutes } = await registerAndCapture({
          route: { name: "crash" },
          controller: {
            crash: () => {
              throw thrown;
            },
          },
          exHandler: makeExceptionHandler(filterResult).exHandler,
        });
        const { ctx, jsonSpy, textSpy } = makeHonoContext();
        const response = await capturedRoutes[0].handler(ctx);

        return {
          response,
          json: jsonSpy.calls.map(({ args }) => args),
          text: textSpy.calls.map(({ args }) => args),
        };
      }

      it("sends the first Response of several filter results", async () => {
        const first = new Response("first");
        const { response } = await answer(new Error("x"), [
          { ignored: true },
          first,
          new Response("second"),
        ]);

        assertStrictEquals(response, first);
      });

      it("serializes other values with the status of the handled error", async () => {
        const notFound = await answer(new NotFoundException(), {
          error: "custom",
        });
        const several = await answer(new Error("x"), ["a", "b"]);
        const text = await answer(new Error("x"), "failed");

        assertEquals(notFound.json, [[
          { error: "custom" },
          StatusCode.NotFound,
        ]]);
        assertEquals(several.json, [
          [["a", "b"], StatusCode.InternalServerError],
        ]);
        assertEquals(text.text, [["failed", StatusCode.InternalServerError]]);
      });

      it("sends an HttpException with its body and status", async () => {
        const exception = new BadRequestException("Invalid input");
        const { json } = await answer(new Error("x"), exception);

        assertEquals(json, [[exception.response, StatusCode.BadRequest]]);
      });

      it("answers with the handled error when a result cannot be serialized", async () => {
        const exception = new NotFoundException();
        const { json } = await answer(exception, () => {});

        assertEquals(json, [[exception.response, StatusCode.NotFound]]);
      });
    });

    it("still clears context via finally when handleError itself throws", async () => {
      const handleSpy = spy(() => {
        throw new Error("handler blew up");
      });
      const exHandler = {
        handle: handleSpy,
        register: spy(async () => {}),
        canHandle: spy(() => false),
      } as unknown as ExceptionHandler;

      const { capturedRoutes } = await registerAndCapture({
        route: { name: "boom" },
        controller: {
          boom: () => {
            throw new Error("original error");
          },
        },
        exHandler,
      });

      const { ctx } = makeHonoContext();
      await assertRejects(
        () => capturedRoutes[0].handler(ctx),
        Error,
        "handler blew up",
      );
    });

    it("passes the Hono context through HostArguments to the exception handler", async () => {
      type HostArgs = {
        switchToHttp: () => { getRequest: <T>() => T; getResponse: <T>() => T };
      };
      let capturedHost: HostArgs | undefined;
      const handleSpy = spy((_err: unknown, host: HostArgs) => {
        capturedHost = host;
        return Promise.resolve(undefined);
      });
      const exHandler = {
        handle: handleSpy,
        register: spy(async () => {}),
        canHandle: spy(() => false),
      } as unknown as ExceptionHandler;

      const { capturedRoutes } = await registerAndCapture({
        route: { name: "err" },
        controller: {
          err: () => {
            throw new Error("host test");
          },
        },
        exHandler,
      });

      const { ctx } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertInstanceOf(
        capturedHost!.switchToHttp().getRequest(),
        HonoRequestContext,
      );
      assertEquals(
        capturedHost!.switchToHttp().getRequest<HonoRequestContext>()
          .getUnderlying(),
        ctx.req,
      );
      assertEquals(capturedHost!.switchToHttp().getResponse(), ctx);
    });
  });

  describe("cors", () => {
    const origin = "https://b.example";

    /** App with `GET`/`POST /items` and `DELETE /items/:id` routes. */
    function createItemsApp(
      cors: boolean | CorsOptions | undefined,
      instance: HttpController = {
        list: () => [],
        create: () => ({ id: 1 }),
        remove: () => null,
      },
    ): Promise<Hono> {
      return createApp([{
        path: "items",
        routes: [
          { name: "list", method: HttpMethod.GET },
          { name: "create", method: HttpMethod.POST },
          { name: "remove", path: ":id", method: HttpMethod.DELETE },
        ],
        instance,
      }], { cors });
    }

    function preflight(
      app: Hono,
      path: string,
      headers: Record<string, string> = {},
    ): Promise<Response> {
      return Promise.resolve(app.request(path, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "DELETE",
          ...headers,
        },
      }));
    }

    for (const cors of [undefined, false]) {
      it(`sends no CORS headers when cors is ${cors}`, async () => {
        const app = await createItemsApp(cors);
        const response = await app.request("/items", {
          method: "POST",
          headers: { origin },
        });

        assertEquals((await preflight(app, "/items")).status, 404);
        assertEquals(response.status, StatusCode.Ok);
        assertEquals(response.headers.get("access-control-allow-origin"), null);
      });
    }

    it("answers preflight requests on every route path without calling the controller", async () => {
      const remove = spy(() => null);
      const app = await createItemsApp(true, {
        list: () => [],
        create: () => ({ id: 1 }),
        remove,
      });

      for (const path of ["/items", "/items/1"]) {
        const response = await preflight(app, path);

        assertEquals(response.status, StatusCode.NoContent);
        assertEquals(response.headers.get("access-control-allow-origin"), "*");
        assertMatch(
          response.headers.get("access-control-allow-methods") ?? "",
          /DELETE/,
        );
      }

      assertSpyCalls(remove, 0);
    });

    it("adds the CORS headers to route responses", async () => {
      const app = await createItemsApp(true);
      const response = await app.request("/items", {
        method: "POST",
        headers: { origin },
      });

      assertEquals(response.status, StatusCode.Ok);
      assertEquals(await response.json(), { id: 1 });
      assertEquals(response.headers.get("access-control-allow-origin"), "*");
    });

    it("applies every CorsOptions field", async () => {
      const app = await createItemsApp({
        origin: ["https://a.example", origin],
        allowMethods: [HttpMethod.GET, "DELETE"],
        allowHeaders: ["X-Custom"],
        maxAge: 3600,
        credentials: true,
        exposeHeaders: ["X-Exposed"],
      });
      const answer = await preflight(app, "/items/1");
      const response = await app.request("/items", { headers: { origin } });

      assertEquals(answer.status, StatusCode.NoContent);
      assertEquals(answer.headers.get("access-control-allow-origin"), origin);
      assertEquals(
        answer.headers.get("access-control-allow-methods"),
        "GET,DELETE",
      );
      assertEquals(
        answer.headers.get("access-control-allow-headers"),
        "X-Custom",
      );
      assertEquals(answer.headers.get("access-control-max-age"), "3600");
      assertEquals(
        answer.headers.get("access-control-allow-credentials"),
        "true",
      );
      assertEquals(response.headers.get("access-control-allow-origin"), origin);
      assertEquals(
        response.headers.get("access-control-expose-headers"),
        "X-Exposed",
      );
      assertEquals(response.headers.get("vary"), "Origin");
    });

    it("keeps the Hono defaults for CorsOptions fields that are not set", async () => {
      const app = await createItemsApp({ origin });
      const answer = await preflight(app, "/items/1", {
        "access-control-request-headers": "authorization",
      });

      assertEquals(answer.status, StatusCode.NoContent);
      assertMatch(
        answer.headers.get("access-control-allow-methods") ?? "",
        /DELETE/,
      );
      assertEquals(
        answer.headers.get("access-control-allow-headers"),
        "authorization",
      );
      assertEquals(answer.headers.get("access-control-max-age"), null);
      assertEquals(
        answer.headers.get("access-control-allow-credentials"),
        null,
      );
    });
  });

  describe("routing", () => {
    it("registers every entry of a route path as its own route", async () => {
      const app = await registerOnHono({
        route: { name: "hello", path: ["a", "b"] },
        controller: { hello: () => "hello" },
      });

      assertEquals(await fetchText(app, "/test/a"), [200, "hello"]);
      assertEquals(await fetchText(app, "/test/b"), [200, "hello"]);
      assertEquals((await app.request("/test/a/b")).status, 404);
    });

    it("serves HEAD routes for HEAD requests only, before GET routes on the same path", async () => {
      const get = spy(() => "body");
      const head = spy(() =>
        new Response(null, { headers: { "x-size": "4" } })
      );
      const app = await createApp([{
        path: "files",
        routes: [
          { name: "get", method: HttpMethod.GET },
          { name: "head", method: HttpMethod.HEAD },
        ],
        instance: { get, head },
      }]);

      const headResponse = await app.request("/files", { method: "HEAD" });

      assertEquals(headResponse.status, StatusCode.Ok);
      assertEquals(headResponse.headers.get("x-size"), "4");
      assertEquals(headResponse.body, null);
      assertEquals(await fetchText(app, "/files"), [200, "body"]);
      assertSpyCalls(head, 1);
      assertSpyCalls(get, 1);
    });

    it("answers HEAD requests with the GET route when no HEAD route exists", async () => {
      const get = spy(() => "body");
      const app = await registerOnHono({
        route: { name: "get" },
        controller: { get },
      });

      const response = await app.request("/test", { method: "HEAD" });

      assertEquals(response.status, StatusCode.Ok);
      assertEquals(response.body, null);
      assertSpyCalls(get, 1);
    });

    it("passes GET requests on from HEAD routes", async () => {
      const app = await createApp([{
        path: "files",
        routes: [{ name: "head", method: HttpMethod.HEAD }],
        instance: { head: () => null },
      }]);

      assertEquals((await app.request("/files")).status, 404);
    });
  });

  describe("host", () => {
    /**
     * App with a `GET /test` route restricted to `admin.example.com`,
     * followed by the same route of an unrestricted controller when
     * `fallback` is set.
     */
    function createHostApp(
      admin: HttpRouteFn,
      options: { fallback?: boolean; cors?: boolean } = {},
    ): Promise<Hono> {
      return createApp([
        {
          path: "test",
          host: "admin.example.com",
          routes: [{ name: "get", method: HttpMethod.GET }],
          instance: { get: admin },
        },
        ...(options.fallback
          ? [{
            path: "test",
            routes: [{ name: "get", method: HttpMethod.GET }],
            instance: { get: () => "public" },
          }]
          : []),
      ], { cors: options.cors });
    }

    it("serves requests for a matching host", async () => {
      const app = await createHostApp(() => "admin");

      assertEquals(
        await fetchText(app, "http://Admin.Example.com:8080/test"),
        [200, "admin"],
      );
    });

    it("passes requests for other hosts on to the next route", async () => {
      const admin = spy(() => "admin");
      const app = await createHostApp(admin, { fallback: true });

      assertEquals(
        await fetchText(app, "http://public.example.com/test"),
        [200, "public"],
      );
      assertSpyCalls(admin, 0);
    });

    it("answers requests for other hosts with 404 and no CORS headers", async () => {
      const app = await createHostApp(() => "admin", { cors: true });
      const headers = {
        origin: "https://b.example",
        "access-control-request-method": "GET",
      };
      const response = await app.request("http://public.example.com/test", {
        headers,
      });
      const answer = await app.request("http://public.example.com/test", {
        method: "OPTIONS",
        headers,
      });
      const matching = await app.request("http://admin.example.com/test", {
        method: "OPTIONS",
        headers,
      });

      assertEquals(response.status, 404);
      assertEquals(response.headers.get("access-control-allow-origin"), null);
      assertEquals(answer.status, 404);
      assertEquals(answer.headers.get("access-control-allow-origin"), null);
      assertEquals(matching.status, StatusCode.NoContent);
      assertEquals(matching.headers.get("access-control-allow-origin"), "*");
    });
  });

  describe("guards", () => {
    it("returns 403 Forbidden when a global guard returns false", async () => {
      const denyGuard: CanActivateFn = () => false;
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "secret" },
        controller: { secret: () => "ok" },
        globalGuards: [denyGuard],
      });

      const { ctx, jsonSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
      const [, status] = jsonSpy.calls[0].args as [unknown, number];
      assertEquals(status, StatusCode.Forbidden);
    });

    it("exposes the correct handler via executionContext.getHandler()", async () => {
      let capturedHandler: unknown;
      const capturingGuard: CanActivateFn = (ctx) => {
        capturedHandler = ctx.getHandler();
        return true;
      };
      const handlerFn = spy(() => "ok");
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "guarded" },
        controller: { guarded: handlerFn },
        globalGuards: [capturingGuard],
      });

      const { ctx } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertEquals(capturedHandler, handlerFn);
    });

    it("exposes the controller class via executionContext.getClass()", async () => {
      let capturedClass: unknown;
      const capturingGuard: CanActivateFn = (ctx) => {
        capturedClass = ctx.getClass();
        return true;
      };
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "guarded" },
        controller: { guarded: () => null },
        globalGuards: [capturingGuard],
      });

      const { ctx } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertEquals(typeof capturedClass, "function");
    });
  });
});
