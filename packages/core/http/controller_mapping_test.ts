import {
  Injectable,
  type InjectionToken,
  InjectorContext,
  Module,
  type Type,
} from "@denorid/injector";
import { Logger } from "@denorid/logger";
import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  assertSpyCall,
  assertSpyCalls,
  type Spy,
  spy,
  stub,
} from "@std/testing/mock";
import { beforeEach, describe, it } from "node:test";
import { z } from "zod";
import {
  CONTROLLER_METADATA,
  CONTROLLER_REQUEST_MAPPING,
  HTTP_CONTROLLER_METADATA,
} from "../_constants.ts";
import type { ExceptionHandler } from "../exceptions/handler.ts";
import { BadRequestException } from "../exceptions/http/bad_request.ts";
import { ZodValidationException } from "../exceptions/http/zod_validation.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import { GUARDS_METADATA } from "../guards/decorator.ts";
import type { ExecutionContext } from "../guards/execution_context.ts";
import type {
  PipeTransform,
  PipeTransformFn,
} from "../pipes/pipe_transform.ts";
import type { RequestMappingMetadata } from "./_request_mapping.ts";
import {
  ControllerMapping,
  type HttpController,
} from "./controller_mapping.ts";
import type { ControllerOptions } from "./controller_options.ts";
import { HttpMethod } from "./method.ts";
import { RequestContext } from "./request_context.ts";

describe("ControllerMapping", () => {
  interface RegisterRouteCall {
    controllerClass: Type<HttpController>;
    controllerBasePath: string;
    controllerGuards: (Type<CanActivate> | CanActivate | CanActivateFn)[];
    route: RequestMappingMetadata;
  }

  class TestControllerMapping extends ControllerMapping {
    public readonly routeCalls: RegisterRouteCall[] = [];

    // deno-lint-ignore require-await
    protected async registerRoute(
      controllerClass: Type<HttpController>,
      controllerBasePath: string,
      controllerGuards: (Type<CanActivate> | CanActivate | CanActivateFn)[],
      route: RequestMappingMetadata,
    ): Promise<void> {
      this.routeCalls.push({
        controllerClass,
        controllerBasePath,
        controllerGuards,
        route,
      });
    }
  }

  /** Request context serving path parameters, query values and headers, recording reads. */
  class TestRequestContext extends RequestContext {
    public readonly reads: string[] = [];

    public constructor(
      private readonly input: {
        params?: Record<string, string>;
        queries?: Record<string, string[]>;
        headers?: Record<string, string>;
      } = {},
    ) {
      super("req-1", undefined);
    }

    public override get ip(): string {
      throw new Error("Method not implemented");
    }

    public override getUnderlying<T = unknown>(): T {
      throw new Error("Method not implemented");
    }

    public override headers(): Record<string, string> {
      this.reads.push("headers");

      return this.input.headers ?? {};
    }

    public override header(_key: string): string | undefined {
      throw new Error("Method not implemented");
    }

    public override params(): Record<string, string> {
      this.reads.push("params");

      return this.input.params ?? {};
    }

    public override param(key: string): string | undefined;
    public override param<T>(
      key: string,
      transformer: PipeTransform<T> | PipeTransformFn<T>,
    ): T;
    public override param<T>(
      _key: string,
      _transformer?: PipeTransform<T> | PipeTransformFn<T>,
    ): string | T | undefined {
      throw new Error("Method not implemented");
    }

    public override queries(): Record<string, string[]>;
    public override queries(key: string): string[];
    public override queries<T>(
      key: string,
      transformer: PipeTransform<T> | PipeTransformFn<T>,
    ): T[];
    public override queries<T>(
      _key?: string,
      _transformer?: PipeTransform<T> | PipeTransformFn<T>,
    ): Record<string, string[]> | string[] | T[] {
      this.reads.push("queries");

      return this.input.queries ?? {};
    }

    public override query(key: string): string | undefined;
    public override query<T>(
      key: string,
      transformer: PipeTransform<T> | PipeTransformFn<T>,
    ): T;
    public override query<T>(
      _key: string,
      _transformer?: PipeTransform<T> | PipeTransformFn<T>,
    ): string | T | undefined {
      throw new Error("Method not implemented");
    }
  }

  interface MockContainer {
    getTokensByTag: (tag: InjectionToken) => InjectionToken[];
    resolve: <T>(token: Type<T>) => Promise<T>;
  }

  function createMockContext(
    tokens: Type[],
    resolveResult?: unknown,
  ): {
    ctx: {
      container: MockContainer;
      resolve: <T>(token: Type<T>) => Promise<T>;
    } & {
      [key: string]: unknown;
    };
    getTokensByTagSpy: Spy;
    resolveSpy: Spy;
  } {
    const resolveFn = spy(<T>(_token: Type<T>) =>
      Promise.resolve((resolveResult ?? {}) as T)
    );

    const container: MockContainer = {
      getTokensByTag: () => tokens,
      resolve: resolveFn as unknown as MockContainer["resolve"],
    };

    const getTokensByTagSpy = spy(container, "getTokensByTag");

    const ctx = {
      container,
      resolve: resolveFn,
      getHostModuleRef: () => ({
        get: resolveFn,
      }),
    } as unknown as {
      container: MockContainer;
      resolve: <T>(token: Type<T>) => Promise<T>;
      [key: string]: unknown;
    };

    return { ctx, getTokensByTagSpy, resolveSpy: resolveFn };
  }

  function setControllerMetadata(
    target: Type,
    controllerMeta: ControllerOptions,
    requestMapping?: RequestMappingMetadata[],
    guards?: Set<Type<CanActivate> | CanActivate | CanActivateFn>,
  ): void {
    Object.defineProperty(target, Symbol.metadata, {
      value: {
        [CONTROLLER_METADATA]: controllerMeta,
        ...(requestMapping !== undefined
          ? { [CONTROLLER_REQUEST_MAPPING]: requestMapping }
          : {}),
        ...(guards !== undefined ? { [GUARDS_METADATA]: guards } : {}),
      },
      writable: true,
      configurable: true,
    });
  }

  describe("normalizePaths()", () => {
    let mapping: TestControllerMapping;

    beforeEach(() => {
      const { ctx } = createMockContext([]);
      mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });
    });

    it("should return an empty array when path is undefined", () => {
      assertEquals(mapping["normalizePaths"](undefined), []);
    });

    it("should wrap a single string in an array", () => {
      assertEquals(mapping["normalizePaths"]("/api"), ["/api"]);
    });

    it("should return the array unchanged when already an array", () => {
      assertEquals(mapping["normalizePaths"](["foo", "bar"]), ["foo", "bar"]);
    });

    it("should wrap an empty string in an array", () => {
      assertEquals(mapping["normalizePaths"](""), [""]);
    });
  });

  describe("joinPaths()", () => {
    let mapping: TestControllerMapping;

    beforeEach(() => {
      const { ctx } = createMockContext([]);
      mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });
    });

    it("should return '/' when called with no parts", () => {
      assertEquals(mapping["joinPaths"](), "/");
    });

    it("should return '/' when all parts are empty strings", () => {
      assertEquals(mapping["joinPaths"]("", ""), "/");
    });

    it("should prefix a single segment with a leading slash", () => {
      assertEquals(mapping["joinPaths"]("api"), "/api");
    });

    it("should join multiple segments with '/'", () => {
      assertEquals(mapping["joinPaths"]("api", "v1", "users"), "/api/v1/users");
    });

    it("should strip leading slashes from each segment", () => {
      assertEquals(mapping["joinPaths"]("/api", "/users"), "/api/users");
    });

    it("should strip trailing slashes from each segment", () => {
      assertEquals(mapping["joinPaths"]("api/", "users/"), "/api/users");
    });

    it("should strip both leading and trailing slashes", () => {
      assertEquals(mapping["joinPaths"]("/api/", "/users/"), "/api/users");
    });

    it("should collapse multiple adjacent slashes at boundaries", () => {
      assertEquals(
        mapping["joinPaths"]("///api///", "///users///"),
        "/api/users",
      );
    });

    it("should filter out empty string parts", () => {
      assertEquals(mapping["joinPaths"]("", "api", "", "users"), "/api/users");
    });

    it("should handle a mix of base path and controller path", () => {
      assertEquals(mapping["joinPaths"]("v1", "products"), "/v1/products");
    });
  });

  describe("register()", () => {
    it("should query the container with HTTP_CONTROLLER_METADATA tag", async () => {
      const { ctx, getTokensByTagSpy } = createMockContext([]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(getTokensByTagSpy.calls.length, 1);
      assertEquals(
        getTokensByTagSpy.calls[0].args[0],
        HTTP_CONTROLLER_METADATA,
      );
    });

    it("should default basePath to empty string when not provided", async () => {
      class FakeController {}
      setControllerMetadata(FakeController, { path: "api" }, []);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(mapping.routeCalls.length, 0);
    });

    it("should prepend the given basePath to each controller path", async () => {
      const route: RequestMappingMetadata = {
        name: "getAll",
        method: HttpMethod.GET,
        path: "/items",
      };
      class FakeController {}
      setControllerMetadata(FakeController, { path: "/products" }, [route]);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register("v1");

      assertEquals(mapping.routeCalls.length, 1);
      assertEquals(mapping.routeCalls[0].controllerBasePath, "/v1/products");
    });

    it("should register routes for every token returned by getTokensByTag", async () => {
      const route1: RequestMappingMetadata = {
        name: "r1",
        method: HttpMethod.GET,
      };
      const route2: RequestMappingMetadata = {
        name: "r2",
        method: HttpMethod.POST,
      };

      class Controller1 {}
      setControllerMetadata(Controller1, { path: "/c1" }, [route1]);

      class Controller2 {}
      setControllerMetadata(Controller2, { path: "/c2" }, [route2]);

      const { ctx } = createMockContext([Controller1, Controller2]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(mapping.routeCalls.length, 2);
    });

    it("should handle an empty token list without errors", async () => {
      const { ctx } = createMockContext([]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(mapping.routeCalls.length, 0);
    });

    it("returns one route per controller path and route path, including the base path", async () => {
      const list: RequestMappingMetadata = {
        name: "list",
        method: HttpMethod.GET,
      };
      const create: RequestMappingMetadata = {
        name: "create",
        method: HttpMethod.POST,
        path: ["new", "/create/"],
      };
      const helper: RequestMappingMetadata = { name: "helper" };

      class Threads {}
      setControllerMetadata(Threads, { path: ["threads", "topics"] }, [
        list,
        create,
        helper,
      ]);

      class Health {}
      setControllerMetadata(Health, {}, [{
        name: "check",
        method: HttpMethod.GET,
        path: "health",
      }]);

      const { ctx } = createMockContext([Threads, Health]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      const routes = await mapping.register("/api/");

      assertEquals(
        routes.map(({ method, path, controller }) => [
          method,
          path,
          controller,
        ]),
        [
          [HttpMethod.GET, "/api/threads", Threads],
          [HttpMethod.POST, "/api/threads/new", Threads],
          [HttpMethod.POST, "/api/threads/create", Threads],
          [HttpMethod.GET, "/api/topics", Threads],
          [HttpMethod.POST, "/api/topics/new", Threads],
          [HttpMethod.POST, "/api/topics/create", Threads],
          [HttpMethod.GET, "/api/health", Health],
        ],
      );
      assertStrictEquals(routes[0].metadata, list);
      assertStrictEquals(routes[2].metadata, create);
      assertEquals(Object.isFrozen(routes), true);
    });

    it("lists the global, controller and method guards of a route without duplicates", async () => {
      const globalGuard: CanActivateFn = () => true;
      const sharedGuard: CanActivateFn = () => true;
      const controllerGuard: CanActivateFn = () => true;
      const methodGuard: CanActivateFn = () => true;

      class FakeController {}
      setControllerMetadata(
        FakeController,
        { path: "guarded" },
        [
          {
            name: "get",
            method: HttpMethod.GET,
            guards: new Set([controllerGuard, methodGuard, globalGuard]),
          },
          { name: "open", method: HttpMethod.GET, path: "open" },
        ],
        new Set([sharedGuard, controllerGuard]),
      );

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [globalGuard, sharedGuard],
        cors: undefined,
      });

      const routes = await mapping.register();

      assertEquals(routes.map(({ guards }) => guards), [
        [globalGuard, sharedGuard, controllerGuard, methodGuard],
        [globalGuard, sharedGuard, controllerGuard],
      ]);
    });
  });

  describe("validateRequest()", () => {
    const Params = z.object({ id: z.coerce.number().int() });
    const Query = z.object({
      limit: z.coerce.number().int().max(100).default(20),
      tags: z.array(z.string()).optional(),
    });
    const Body = z.object({ name: z.string().min(1) });
    const TenantHeaders = z.object({ "x-tenant-id": z.uuid() });

    function createMapping(): TestControllerMapping {
      const { ctx } = createMockContext([]);

      return new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });
    }

    function validate(
      context: TestRequestContext,
      route: Omit<RequestMappingMetadata, "name">,
      body: () => Promise<unknown> = () => Promise.resolve({ name: "Ada" }),
    ): {
      validated: Promise<void>;
      readBody: Spy<unknown, ["json" | "form"], Promise<unknown>>;
    } {
      const readBody = spy((_type: "json" | "form") => body());

      return {
        validated: createMapping()["validateRequest"](
          context,
          { name: "handler", method: HttpMethod.POST, ...route },
          readBody,
        ),
        readBody,
      };
    }

    function messageOf(error: BadRequestException): unknown {
      return typeof error.response === "object"
        ? error.response.message
        : error.response;
    }

    it("exposes the parsed path parameters, query, headers and body", async () => {
      const tenant = crypto.randomUUID();
      const context = new TestRequestContext({
        params: { id: "7" },
        queries: { limit: ["5"], tags: ["a"] },
        headers: { "x-tenant-id": tenant, accept: "application/json" },
      });
      const { validated, readBody } = validate(context, {
        params: Params,
        query: Query,
        headers: TenantHeaders,
        validation: { type: "json", dto: Body },
      });

      await validated;

      assertEquals(context.validated(Params), { id: 7 });
      assertEquals(context.validated(Query), { limit: 5, tags: ["a"] });
      assertEquals(context.validated(TenantHeaders), { "x-tenant-id": tenant });
      assertEquals(context.validated(Body), { name: "Ada" });
      assertStrictEquals(context.dto, context.validated(Body));
      assertEquals(context.reads, ["params", "queries", "headers"]);
      assertSpyCall(readBody, 0, { args: ["json"] });
    });

    it("reads the body in the format of the route", async () => {
      const context = new TestRequestContext();
      const { validated, readBody } = validate(context, {
        validation: { type: "form", dto: Body },
      });

      await validated;

      assertSpyCall(readBody, 0, { args: ["form"] });
      assertEquals(context.dto, { name: "Ada" });
    });

    it("rejects invalid path parameters before reading the query, the headers and the body", async () => {
      const context = new TestRequestContext({
        params: { id: "abc" },
        queries: { limit: ["5"] },
      });
      const { validated, readBody } = validate(context, {
        params: Params,
        query: Query,
        headers: TenantHeaders,
        validation: { type: "json", dto: Body },
      });

      const error = await assertRejects(
        () => validated,
        ZodValidationException,
      );

      assertEquals(error.status, 400);
      assertEquals(context.reads, ["params"]);
      assertSpyCalls(readBody, 0);
    });

    it("rejects an invalid query before reading the headers and the body", async () => {
      const context = new TestRequestContext({ queries: { limit: ["500"] } });
      const { validated, readBody } = validate(context, {
        query: Query,
        headers: TenantHeaders,
        validation: { type: "json", dto: Body },
      });

      const error = await assertRejects(
        () => validated,
        ZodValidationException,
      );

      assertMatch(String(messageOf(error)), /^limit: /);
      assertEquals(context.reads, ["queries"]);
      assertSpyCalls(readBody, 0);
    });

    it("validates the headers by lowercase name, joining names that only differ in case", async () => {
      const AllHeaders = z.record(z.string(), z.string());
      const tenant = crypto.randomUUID();
      const context = new TestRequestContext({
        headers: {
          "X-Tenant-Id": tenant,
          "X-Trace": "a",
          "x-trace": "b",
          accept: "application/json",
        },
      });

      await validate(context, { headers: TenantHeaders }).validated;
      await validate(context, { headers: AllHeaders }).validated;

      assertEquals(context.validated(TenantHeaders), { "x-tenant-id": tenant });
      assertEquals(context.validated(AllHeaders), {
        "x-tenant-id": tenant,
        "x-trace": "a, b",
        accept: "application/json",
      });
    });

    it("rejects invalid headers after the path parameters and the query and before reading the body", async () => {
      const context = new TestRequestContext({
        params: { id: "7" },
        queries: { limit: ["5"] },
        headers: { "X-Tenant-Id": "not-a-uuid" },
      });
      const { validated, readBody } = validate(context, {
        params: Params,
        query: Query,
        headers: TenantHeaders,
        validation: { type: "json", dto: Body },
      });

      const error = await assertRejects(
        () => validated,
        ZodValidationException,
      );

      assertEquals(error.status, 400);
      assertMatch(String(messageOf(error)), /^x-tenant-id: /);
      assertEquals(context.reads, ["params", "queries", "headers"]);
      assertSpyCalls(readBody, 0);
    });

    it("rejects a scalar query key given more than once", async () => {
      const context = new TestRequestContext({
        queries: { limit: ["1", "2"] },
      });
      const { validated } = validate(context, { query: Query });

      await assertRejects(() => validated, ZodValidationException);
    });

    it("rejects an invalid body", async () => {
      const context = new TestRequestContext();
      const { validated } = validate(
        context,
        { validation: { type: "json", dto: Body } },
        () => Promise.resolve({ name: "" }),
      );

      await assertRejects(() => validated, ZodValidationException);
      assertEquals(context.dto, undefined);
    });

    it("answers a body that cannot be read with Bad Request", async () => {
      const context = new TestRequestContext();
      const { validated } = validate(
        context,
        { validation: { type: "json", dto: Body } },
        () => Promise.reject(new SyntaxError("Unexpected token")),
      );

      const error = await assertRejects(() => validated, BadRequestException);

      assertEquals(error instanceof ZodValidationException, false);
      assertEquals(messageOf(error), "Malformed request body");
    });

    it("reads nothing for routes without schemas", async () => {
      const context = new TestRequestContext();
      const { validated, readBody } = validate(context, {});

      await validated;

      assertEquals(context.reads, []);
      assertSpyCalls(readBody, 0);
      assertEquals(context.dto, undefined);
    });

    it("runs async refinements", async () => {
      const Unique = z.object({ name: z.string() }).refine(
        async ({ name }) => await Promise.resolve(name !== "taken"),
        "name is taken",
      );
      const route = { validation: { type: "json" as const, dto: Unique } };
      const taken = validate(
        new TestRequestContext(),
        route,
        () => Promise.resolve({ name: "taken" }),
      );
      const free = new TestRequestContext();

      const error = await assertRejects(
        () => taken.validated,
        ZodValidationException,
      );
      await validate(free, route, () => Promise.resolve({ name: "free" }))
        .validated;

      assertEquals(messageOf(error), ["name is taken"]);
      assertEquals(free.validated(Unique), { name: "free" });
    });

    it("lets ctx.validated() throw for schemas the route does not declare", async () => {
      const context = new TestRequestContext({ params: { id: "1" } });

      assertThrows(() => context.validated(Params), Error, "not validated");

      await validate(context, { params: Params }).validated;

      assertThrows(() => context.validated(Query), Error, "not validated");
    });
  });

  describe("registerController()", () => {
    it("should call registerRoute once per route in the request mapping", async () => {
      const route1: RequestMappingMetadata = {
        name: "getAll",
        method: HttpMethod.GET,
        path: "/all",
      };
      const route2: RequestMappingMetadata = {
        name: "getOne",
        method: HttpMethod.GET,
        path: "/:id",
      };

      class FakeController {}
      setControllerMetadata(FakeController, { path: "/items" }, [
        route1,
        route2,
      ]);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(mapping.routeCalls.length, 2);
      assertEquals(mapping.routeCalls[0].route, route1);
      assertEquals(mapping.routeCalls[1].route, route2);
    });

    it("should pass the controller class to registerRoute", async () => {
      const route: RequestMappingMetadata = {
        name: "get",
        method: HttpMethod.GET,
      };

      class FakeController {}
      setControllerMetadata(FakeController, { path: "/test" }, [route]);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(mapping.routeCalls[0].controllerClass, FakeController);
    });

    it("should fall back to an empty route list when CONTROLLER_REQUEST_MAPPING is absent", async () => {
      class FakeController {}
      setControllerMetadata(FakeController, { path: "/items" });

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(mapping.routeCalls.length, 0);
    });

    it("should register the routes once per entry of an array controller path", async () => {
      const route: RequestMappingMetadata = {
        name: "get",
        method: HttpMethod.GET,
        path: "/",
      };

      class FakeController {}
      setControllerMetadata(FakeController, { path: ["api", "v1"] }, [route]);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(
        mapping.routeCalls.map(({ controllerBasePath, route }) => [
          controllerBasePath,
          route.name,
        ]),
        [["/api", "get"], ["/v1", "get"]],
      );
    });

    it("should register the routes once at the root for an empty array controller path", async () => {
      const route: RequestMappingMetadata = {
        name: "get",
        method: HttpMethod.GET,
      };

      class FakeController {}
      setControllerMetadata(FakeController, { path: [] }, [route]);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register("v1");

      assertEquals(
        mapping.routeCalls.map(({ controllerBasePath }) => controllerBasePath),
        ["/v1"],
      );
    });

    it("should resolve to '/' when controller path is undefined", async () => {
      const route: RequestMappingMetadata = {
        name: "get",
        method: HttpMethod.GET,
      };

      class FakeController {}
      setControllerMetadata(FakeController, { path: undefined }, [route]);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(mapping.routeCalls.length, 1);
      assertEquals(mapping.routeCalls[0].controllerBasePath, "/");
    });

    it("should combine basePath with each array controller path", async () => {
      const route: RequestMappingMetadata = {
        name: "create",
        method: HttpMethod.POST,
      };

      class FakeController {}
      setControllerMetadata(FakeController, { path: ["users", "profile"] }, [
        route,
      ]);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register("v2");

      assertEquals(
        mapping.routeCalls.map(({ controllerBasePath }) => controllerBasePath),
        ["/v2/users", "/v2/profile"],
      );
    });

    it("should skip entries without an HTTP method", async () => {
      const index: RequestMappingMetadata = {
        name: "index",
        method: HttpMethod.GET,
        path: "/",
      };
      const guarded: RequestMappingMetadata = {
        name: "internalHandler",
        guards: new Set([() => true]),
      };
      const withStatus: RequestMappingMetadata = {
        name: "forgotPost",
        statusCode: 201,
      };
      const create: RequestMappingMetadata = {
        name: "create",
        method: HttpMethod.POST,
      };

      class FakeController {}
      setControllerMetadata(FakeController, { path: "x" }, [
        index,
        guarded,
        withStatus,
        create,
      ]);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(mapping.routeCalls.map(({ route }) => route), [
        index,
        create,
      ]);
    });

    it("should strip slashes from basePath when joining", async () => {
      const route: RequestMappingMetadata = {
        name: "get",
        method: HttpMethod.GET,
      };

      class FakeController {}
      setControllerMetadata(FakeController, { path: "/api/" }, [route]);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register("/v1/");

      assertEquals(mapping.routeCalls[0].controllerBasePath, "/v1/api");
    });

    it("should pass guards from GUARDS_METADATA to registerRoute", async () => {
      const route: RequestMappingMetadata = {
        name: "get",
        method: HttpMethod.GET,
      };
      const guardFn: CanActivateFn = (_ctx) => true;

      class FakeController {}
      setControllerMetadata(
        FakeController,
        { path: "/guarded" },
        [route],
        new Set([guardFn]),
      );

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(mapping.routeCalls.length, 1);
      assertEquals(mapping.routeCalls[0].controllerGuards, [guardFn]);
    });

    it("should pass empty guards array when GUARDS_METADATA is absent", async () => {
      const route: RequestMappingMetadata = {
        name: "get",
        method: HttpMethod.GET,
      };

      class FakeController {}
      setControllerMetadata(FakeController, { path: "/open" }, [route]);

      const { ctx } = createMockContext([FakeController]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      await mapping.register();

      assertEquals(mapping.routeCalls.length, 1);
      assertEquals(mapping.routeCalls[0].controllerGuards, []);
    });
  });

  describe("matchesHost()", () => {
    function matches(
      host: ControllerOptions["host"],
      hostname: string,
    ): boolean {
      class FakeController {}
      setControllerMetadata(FakeController, { path: "/", host });

      const { ctx } = createMockContext([]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      return mapping["matchesHost"](
        FakeController as Type<HttpController>,
        hostname,
      );
    }

    it("should match every host when the controller has no host option", () => {
      assertEquals(matches(undefined, "public.example.com"), true);
    });

    it("should match every host when the controller has no metadata", () => {
      const { ctx } = createMockContext([]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      class Plain {}
      Object.defineProperty(Plain, Symbol.metadata, { value: null });

      assertEquals(
        mapping["matchesHost"](Plain as Type<HttpController>, "a.test"),
        true,
      );
    });

    it("should match a string host case-insensitively", () => {
      assertEquals(matches("Admin.Example.com", "admin.example.COM"), true);
    });

    it("should reject a different host", () => {
      assertEquals(matches("admin.example.com", "public.example.com"), false);
    });

    it("should not match a string host as a suffix or prefix", () => {
      assertEquals(matches("example.com", "admin.example.com"), false);
      assertEquals(
        matches("admin.example.com", "admin.example.com.evil"),
        false,
      );
    });

    it("should ignore the port of the request", () => {
      assertEquals(
        matches("admin.example.com", "admin.example.com:8080"),
        true,
      );
      assertEquals(matches(/^admin\./, "admin.example.com:8080"), true);
      assertEquals(matches("[::1]", "[::1]:3000"), true);
    });

    it("should keep a bare IPv6 address intact", () => {
      assertEquals(matches("::1", "::1"), true);
    });

    it("should test a RegExp against the hostname", () => {
      assertEquals(matches(/^(.+)\.example\.com$/, "tenant.example.com"), true);
      assertEquals(matches(/^(.+)\.example\.com$/, "example.com"), false);
    });

    it("should give the same result for repeated calls with a global RegExp", () => {
      const pattern = /^api\./g;

      assertEquals(matches(pattern, "api.example.com"), true);
      assertEquals(matches(pattern, "api.example.com"), true);
    });

    it("should match when any entry of an array matches", () => {
      const host = ["admin.example.com", /^api\./];

      assertEquals(matches(host, "admin.example.com"), true);
      assertEquals(matches(host, "api.example.org"), true);
      assertEquals(matches(host, "public.example.com"), false);
    });

    it("should match nothing for an empty array", () => {
      assertEquals(matches([], "admin.example.com"), false);
    });
  });

  describe("resolveGuards()", () => {
    const mockExecCtx = {} as ExecutionContext;

    it("should return true when no guards are provided", async () => {
      const { ctx } = createMockContext([]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      const result = await mapping["resolveGuards"](mockExecCtx);
      assertEquals(result, true);
    });

    it("should return true when all guards allow the request", async () => {
      const { ctx } = createMockContext([]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      const guardA: CanActivateFn = (_ctx) => true;
      const guardB: CanActivateFn = (_ctx) => true;

      const result = await mapping["resolveGuards"](
        mockExecCtx,
        guardA,
        guardB,
      );
      assertEquals(result, true);
    });

    it("should return false and stop early when a guard denies the request", async () => {
      const { ctx } = createMockContext([]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      const denySpy = spy((_ctx: ExecutionContext) => false);
      const neverCalled = spy((_ctx: ExecutionContext) => true);

      const result = await mapping["resolveGuards"](
        mockExecCtx,
        denySpy as unknown as CanActivateFn,
        neverCalled as unknown as CanActivateFn,
      );
      assertEquals(result, false);
      assertEquals(neverCalled.calls.length, 0);
    });
  });

  describe("resolveGuard()", () => {
    const mockExecCtx = {
      switchToHttp: () => ({
        getRequest: () => ({ contextId: Symbol() }),
      }),
    } as unknown as ExecutionContext;

    it("should resolve a class-based guard and call canActivate", async () => {
      class MyGuard implements CanActivate {
        canActivate(_ctx: ExecutionContext): boolean {
          return true;
        }
      }

      const instance = new MyGuard();
      const { ctx } = createMockContext([], instance);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      const result = await mapping["resolveGuard"](mockExecCtx, MyGuard);
      assertEquals(result, true);
    });

    it("should invoke a function-based guard directly", async () => {
      const { ctx } = createMockContext([]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      const guardFn: CanActivateFn = (_ctx) => false;
      const result = await mapping["resolveGuard"](mockExecCtx, guardFn);
      assertEquals(result, false);
    });

    it("should call canActivate on a guard instance", async () => {
      const { ctx } = createMockContext([]);
      const mapping = new TestControllerMapping({
        ctx: ctx as never,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      const instance: CanActivate = {
        canActivate: (_ctx) => true,
      };

      const result = await mapping["resolveGuard"](mockExecCtx, instance);
      assertEquals(result, true);
    });

    it("should resolve a guard class declared in a module that does not export it", async () => {
      @Injectable()
      class ModuleGuard implements CanActivate {
        public canActivate(_ctx: ExecutionContext): boolean {
          return true;
        }
      }

      @Module({ providers: [ModuleGuard] })
      class GuardModule {}

      @Module({ imports: [GuardModule] })
      class AppModule {}

      using _log = stub(Logger.prototype, "log");
      await using ctx = await InjectorContext.create(AppModule);
      const mapping = new TestControllerMapping({
        ctx,
        exceptionHandler: {} as ExceptionHandler,
        globalGuards: [],
        cors: undefined,
      });

      const result = await mapping["resolveGuard"](
        {
          switchToHttp: () => ({ getRequest: () => ({ contextId: "req-1" }) }),
        } as unknown as ExecutionContext,
        ModuleGuard,
      );
      assertEquals(result, true);
    });
  });
});
