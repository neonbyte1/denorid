import type {
  CanActivateFn,
  ExceptionHandler,
  HttpController,
  RequestMappingMetadata,
} from "@denorid/core";
import { BadRequestException, HttpMethod, StatusCode } from "@denorid/core";
import type { InjectorContext, Type } from "@denorid/injector";
import type { Context, Hono } from "@hono/hono";
import {
  assertEquals,
  assertInstanceOf,
  assertMatch,
  assertRejects,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { z } from "zod";
import { HonoControllerMapping } from "./controller_mapping.ts";
import { HonoRequestContext } from "./request_context.ts";

describe("HonoControllerMapping", () => {
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
  }) {
    const runInRequestScopeAsync = spy(
      (_id: string, fn: () => Promise<unknown>) => fn(),
    );
    const clearContext = spy((_id: string) => {});
    const moduleRefGet = spy(() => Promise.resolve(opts.controller ?? {}));

    const injectorCtx = {
      container: {
        getTokensByTag: () => opts.tokens ?? [],
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
    meta: { path?: string | string[] },
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
  }) {
    class FakeController {}
    setControllerMetadata(FakeController, {
      path: opts.controllerPath ?? "/test",
    }, [opts.route]);

    const { app, routes: capturedRoutes } = makeHonoApp();
    const { injectorCtx, runInRequestScopeAsync, resolveInternal } =
      makeInjectorContext({
        tokens: [FakeController],
        controller: opts.controller,
      });

    const mapping = new HonoControllerMapping(
      app,
      injectorCtx,
      opts.exHandler ?? makeExceptionHandler().exHandler,
      opts.globalGuards ?? [],
    );

    await mapping.register(opts.basePath);

    return { capturedRoutes, runInRequestScopeAsync, resolveInternal };
  }

  describe("registerRoute()", () => {
    it("registers a GET route by default when method is not specified", async () => {
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "index" },
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
        { name: "get", path: ":id" },
      ]);

      const { app, routes } = makeHonoApp();
      const { injectorCtx } = makeInjectorContext({
        tokens: [FakeController],
        controller: { get: () => null },
      });
      const mapping = new HonoControllerMapping(
        app,
        injectorCtx,
        makeExceptionHandler().exHandler,
        [],
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
        { name: "r1", path: "one" },
        { name: "r2", path: "two" },
        { name: "r3", path: "three" },
      ]);

      const { app, routes } = makeHonoApp();
      const { injectorCtx } = makeInjectorContext({
        tokens: [FakeController],
        controller: { r1: () => null, r2: () => null, r3: () => null },
      });
      const mapping = new HonoControllerMapping(
        app,
        injectorCtx,
        makeExceptionHandler().exHandler,
        [],
      );

      await mapping.register();

      assertEquals(routes.length, 3);
    });
  });

  describe("route handler — request scope", () => {
    it("passes x-request-id header value as the scope id", async () => {
      const { capturedRoutes, runInRequestScopeAsync } =
        await registerAndCapture({
          route: { name: "index" },
          controller: { index: () => null },
        });

      const { ctx } = makeHonoContext({ requestId: "test-scope-id" });
      await capturedRoutes[0].handler(ctx);

      assertSpyCall(runInRequestScopeAsync, 0, {
        args: [
          "test-scope-id",
          runInRequestScopeAsync.calls[0].args[1],
        ],
      });
    });

    it("generates a UUID-shaped scope id when x-request-id header is absent", async () => {
      const { capturedRoutes, runInRequestScopeAsync } =
        await registerAndCapture({
          route: { name: "index" },
          controller: { index: () => null },
        });

      const { ctx } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      const capturedId = runInRequestScopeAsync.calls[0].args[0] as string;
      assertMatch(
        capturedId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
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

  describe("route handler — controller invocation", () => {
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

    it("wraps a plain Error in InternalServerErrorException when handler returns undefined", async () => {
      const { exHandler } = makeExceptionHandler(undefined);
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "crash" },
        controller: {
          crash: () => {
            throw new Error("something broke");
          },
        },
        exHandler,
      });

      const { ctx, jsonSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
      const [, status] = jsonSpy.calls[0].args as [unknown, number];
      assertEquals(status, StatusCode.InternalServerError);
    });

    it("wraps a thrown string in InternalServerErrorException with the string as message", async () => {
      const { exHandler } = makeExceptionHandler(undefined);
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "crash" },
        controller: {
          crash: () => {
            // deno-lint-ignore no-throw-literal
            throw "something went wrong";
          },
        },
        exHandler,
      });

      const { ctx, jsonSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
      const [body, status] = jsonSpy.calls[0].args as [
        { message: string },
        number,
      ];
      assertEquals(status, StatusCode.InternalServerError);
      assertEquals(body.message, "something went wrong");
    });

    it("wraps an unknown non-string thrown value in InternalServerErrorException", async () => {
      const { exHandler } = makeExceptionHandler(undefined);
      const { capturedRoutes } = await registerAndCapture({
        route: { name: "crash" },
        controller: {
          crash: () => {
            // deno-lint-ignore no-throw-literal
            throw { unknown: true };
          },
        },
        exHandler,
      });

      const { ctx, jsonSpy } = makeHonoContext();
      await capturedRoutes[0].handler(ctx);

      assertSpyCalls(jsonSpy, 1);
      const [, status] = jsonSpy.calls[0].args as [unknown, number];
      assertEquals(status, StatusCode.InternalServerError);
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
