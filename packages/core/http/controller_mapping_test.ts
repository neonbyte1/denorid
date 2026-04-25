import type { InjectionToken, Type } from "@denorid/injector";
import { assertEquals } from "@std/assert";
import { beforeEach, describe, it } from "@std/testing/bdd";
import { type Spy, spy } from "@std/testing/mock";
import {
  CONTROLLER_METADATA,
  CONTROLLER_REQUEST_MAPPING,
  HTTP_CONTROLLER_METADATA,
} from "../_constants.ts";
import type { ExceptionHandler } from "../exceptions/handler.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import { GUARDS_METADATA } from "../guards/decorator.ts";
import type { ExecutionContext } from "../guards/execution_context.ts";
import type { RequestMappingMetadata } from "./_request_mapping.ts";
import {
  ControllerMapping,
  type HttpController,
} from "./controller_mapping.ts";

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
    controllerMeta: { path?: string | string[] },
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
      const route: RequestMappingMetadata = { name: "getAll", path: "/items" };
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
      const route1: RequestMappingMetadata = { name: "r1" };
      const route2: RequestMappingMetadata = { name: "r2" };

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
  });

  describe("registerController()", () => {
    it("should call registerRoute once per route in the request mapping", async () => {
      const route1: RequestMappingMetadata = { name: "getAll", path: "/all" };
      const route2: RequestMappingMetadata = { name: "getOne", path: "/:id" };

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
      const route: RequestMappingMetadata = { name: "get" };

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

    it("should handle array-based controller paths", async () => {
      const route: RequestMappingMetadata = { name: "get", path: "/" };

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

      assertEquals(mapping.routeCalls.length, 1);
      assertEquals(mapping.routeCalls[0].controllerBasePath, "/api/v1");
    });

    it("should resolve to '/' when controller path is undefined", async () => {
      const route: RequestMappingMetadata = { name: "get" };

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

    it("should combine basePath and array controller paths correctly", async () => {
      const route: RequestMappingMetadata = { name: "create" };

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

      assertEquals(mapping.routeCalls.length, 1);
      assertEquals(
        mapping.routeCalls[0].controllerBasePath,
        "/v2/users/profile",
      );
    });

    it("should strip slashes from basePath when joining", async () => {
      const route: RequestMappingMetadata = { name: "get" };

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
      const route: RequestMappingMetadata = { name: "get" };
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
      const route: RequestMappingMetadata = { name: "get" };

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
  });
});
