import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { Logger } from "@denorid/logger";
import { stub } from "@std/testing/mock";
import { describe, it } from "node:test";
import {
  noopLogger,
  RequestScopedService,
  ServiceWithModuleRef,
  SimpleService,
  TAG_A,
  TaggedServiceA,
  TransientService,
} from "./_test_fixtures.ts";
import type { Type } from "./common.ts";
import { Container } from "./container.ts";
import { Global, Inject, Injectable, Module, Tags } from "./decorators.ts";
import {
  LifecycleError,
  ModuleCompilationError,
  TokenNotFoundError,
} from "./errors.ts";
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnBeforeApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from "./hooks.ts";
import { InjectorContext } from "./injector_context.ts";
import { ModuleRef } from "./module_ref.ts";
import type { DynamicModule } from "./modules.ts";

describe("InjectorContext", () => {
  describe("create", () => {
    it("should create context from simple module", async () => {
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      assertExists(ctx);
    });

    it("should create context with nested modules", async () => {
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class SubModule {}

      @Module({ imports: [SubModule], providers: [], exports: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(SimpleService);

      assertInstanceOf(service, SimpleService);
    });

    it("should support dynamic modules", async () => {
      const CONFIG_TOKEN = Symbol("CONFIG");

      @Module({})
      class ConfigModule {
        static forRoot(config: { value: string }): DynamicModule {
          return {
            module: ConfigModule,
            providers: [{ provide: CONFIG_TOKEN, useValue: config }],
            exports: [CONFIG_TOKEN],
          };
        }
      }

      @Module({
        imports: [ConfigModule.forRoot({ value: "test" })],
        exports: [CONFIG_TOKEN],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const config = await ctx.resolve<{ value: string }>(CONFIG_TOKEN);

      assertEquals(config.value, "test");
    });

    it("should support global modules", async () => {
      @Global()
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class GlobalModule {}

      @Injectable()
      class Consumer {
        @Inject(SimpleService)
        simple!: SimpleService;
      }

      @Module({
        imports: [GlobalModule],
        providers: [Consumer],
        exports: [Consumer],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const consumer = await ctx.resolve(Consumer);

      assertInstanceOf(consumer.simple, SimpleService);
    });

    it("should call onModuleInit in order", async () => {
      const order: string[] = [];

      @Injectable()
      class ServiceA implements OnModuleInit {
        onModuleInit() {
          order.push("ServiceA");
        }
      }

      @Module({ providers: [ServiceA] })
      class SubModule implements OnModuleInit {
        onModuleInit() {
          order.push("SubModule");
        }
      }

      @Module({ imports: [SubModule] })
      class AppModule implements OnModuleInit {
        onModuleInit() {
          order.push("AppModule");
        }
      }

      await InjectorContext.create(AppModule);
      assertEquals(order, ["ServiceA", "SubModule", "AppModule"]);
    });

    it("should skip request-scoped during init", async () => {
      let initialized = false;

      @Injectable({ mode: "request" })
      class RequestService implements OnModuleInit {
        onModuleInit() {
          initialized = true;
        }
      }

      @Module({ providers: [RequestService] })
      class AppModule {}

      await InjectorContext.create(AppModule);
      assertEquals(initialized, false);
    });

    it("should throw for non-module class", async () => {
      class NotAModule {}

      await assertRejects(
        () => InjectorContext.create(NotAModule),
        ModuleCompilationError,
      );
    });

    it("should use global providers by default", async () => {
      @Global()
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class GlobalModule {}

      @Module({ imports: [GlobalModule], exports: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(SimpleService);
      assertExists(service);
    });

    it("should skip global providers when useGlobals is false", async () => {
      @Global()
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class GlobalModule {}

      @Module({ imports: [GlobalModule] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule, {
        useGlobals: false,
      });

      const service = await ctx.resolve(SimpleService);

      assertExists(service);
    });
  });

  describe("resolve", () => {
    it("should resolve exported token", async () => {
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(SimpleService);

      assertInstanceOf(service, SimpleService);
    });

    it("should resolve root module", async () => {
      @Module({ providers: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const module = await ctx.resolve(AppModule);

      assertInstanceOf(module, AppModule);
    });

    it("should reject for non-exported own token", async () => {
      @Module({ providers: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const result = ctx.resolve(SimpleService);

      assertInstanceOf(result, Promise);
      await assertRejects(() => result, TokenNotFoundError);
    });

    it("should resolve child exports", async () => {
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class SubModule {}

      @Module({ imports: [SubModule], exports: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(SimpleService);
      assertInstanceOf(service, SimpleService);
    });

    it("should handle async module imports", async () => {
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class AsyncModule {}

      const asyncImport: Promise<DynamicModule> = Promise.resolve({
        module: AsyncModule,
        providers: [],
        exports: [SimpleService],
      });

      @Module({ imports: [asyncImport], exports: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(SimpleService);
      assertExists(service);
    });
  });

  describe("tryResolve", () => {
    it("should return undefined for non-exported", async () => {
      @Module({ providers: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const result = await ctx.tryResolve(SimpleService);
      assertEquals(result, undefined);
    });
  });

  describe("resolveInternal", () => {
    it("should bypass export check", async () => {
      @Module({ providers: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolveInternal(SimpleService);
      assertInstanceOf(service, SimpleService);
    });
  });

  describe("resolveWithinContext", () => {
    it("should reject with TokenNotFoundError for non-exported own token", async () => {
      @Module({ providers: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const result = ctx.resolveWithinContext(SimpleService, "ctx-1");

      assertInstanceOf(result, Promise);
      await assertRejects(() => result, TokenNotFoundError);
    });

    it("should resolve exported transient and cache per contextId", async () => {
      @Module({ providers: [TransientService], exports: [TransientService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      const a = await ctx.resolveWithinContext(TransientService, "ctx-1");
      const b = await ctx.resolveWithinContext(TransientService, "ctx-1");

      assertEquals(a.id, b.id);
    });

    it("should return different transient instance for different contextIds", async () => {
      @Module({ providers: [TransientService], exports: [TransientService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      const a = await ctx.resolveWithinContext(TransientService, "ctx-1");
      const b = await ctx.resolveWithinContext(TransientService, "ctx-2");

      assert(a.id !== b.id);
    });

    it("should resolve root module type", async () => {
      @Module({})
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const mod = await ctx.resolveWithinContext(AppModule, "ctx-1");

      assertInstanceOf(mod, AppModule);
    });

    it("should fall through for token not in root module", async () => {
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class FeatureModule {}

      @Module({ imports: [FeatureModule] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolveWithinContext(SimpleService, "ctx-1");

      assertInstanceOf(service, SimpleService);
    });
  });

  describe("clearContext", () => {
    it("should release context-cached transient instances", async () => {
      @Module({ providers: [TransientService], exports: [TransientService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      const a = await ctx.resolveWithinContext(TransientService, "ctx-1");
      ctx.clearContext("ctx-1");
      const b = await ctx.resolveWithinContext(TransientService, "ctx-1");

      assert(a.id !== b.id);
    });
  });

  describe("getRootModule", () => {
    it("should return root module instance", async () => {
      @Module({})
      class AppModule {
        name = "root";
      }

      const ctx = await InjectorContext.create(AppModule);
      const root = await ctx.getRootModule<AppModule>();
      assertEquals(root.name, "root");
    });
  });

  describe("getHostModuleRef", () => {
    it("should return the ModuleRef for the root module", async () => {
      @Injectable()
      class HostService {}

      @Module({ providers: [HostService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const moduleRef = ctx.getHostModuleRef();

      assertInstanceOf(moduleRef, ModuleRef);
      assert(moduleRef.has(HostService));
    });
  });

  describe("request scope", () => {
    it("should run in request scope (sync)", async () => {
      @Module({
        providers: [RequestScopedService],
        exports: [RequestScopedService],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const result = ctx.runInRequestScope("req-1", () => {
        return "sync-result";
      });

      assertEquals(result, "sync-result");
    });

    it("should run in request scope (async)", async () => {
      @Module({
        providers: [RequestScopedService],
        exports: [RequestScopedService],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      let id1: string = "";
      let id2: string = "";

      await ctx.runInRequestScopeAsync("req-1", async () => {
        const service = await ctx.resolveInternal(RequestScopedService);
        id1 = service.id;
        const service2 = await ctx.resolveInternal(RequestScopedService);
        assertEquals(service.id, service2.id);
      });

      await ctx.runInRequestScopeAsync("req-2", async () => {
        const service = await ctx.resolveInternal(RequestScopedService);
        id2 = service.id;
      });

      assert(id1 !== id2);
    });
  });

  describe("lifecycle hooks", () => {
    it("should trigger onApplicationBootstrap", async () => {
      let bootstrapped = false;

      @Injectable()
      class Service implements OnApplicationBootstrap {
        onApplicationBootstrap() {
          bootstrapped = true;
        }
      }

      @Module({ providers: [Service], exports: [Service] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      assertEquals(bootstrapped, false);
      await ctx.onApplicationBootstrap();
      assertEquals(bootstrapped, true);
    });

    it("should only bootstrap once", async () => {
      let count = 0;

      @Injectable()
      class Service implements OnApplicationBootstrap {
        onApplicationBootstrap() {
          count++;
        }
      }

      @Module({ providers: [Service] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await ctx.onApplicationBootstrap();
      await ctx.onApplicationBootstrap();
      assertEquals(count, 1);
    });

    it("should trigger onBeforeApplicationShutdown", async () => {
      let signal: string | undefined;

      @Injectable()
      class Service implements OnBeforeApplicationShutdown {
        onBeforeApplicationShutdown(s?: string) {
          signal = s;
        }
      }

      @Module({ providers: [Service] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await ctx.onBeforeApplicationShutdown("SIGTERM");
      assertEquals(signal, "SIGTERM");
    });

    it("should only shutdown once", async () => {
      let count = 0;

      @Injectable()
      class Service implements OnBeforeApplicationShutdown {
        onBeforeApplicationShutdown() {
          count++;
        }
      }

      @Module({ providers: [Service] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await ctx.onBeforeApplicationShutdown();
      await ctx.onBeforeApplicationShutdown();
      assertEquals(count, 1);
    });

    it("should trigger onModuleDestroy and onApplicationShutdown", async () => {
      const order: string[] = [];

      @Injectable()
      class Service implements OnModuleDestroy, OnApplicationShutdown {
        onModuleDestroy() {
          order.push("destroy");
        }
        onApplicationShutdown(signal?: string) {
          order.push(`shutdown:${signal}`);
        }
      }

      @Module({ providers: [Service] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await ctx.onApplicationShutdown("SIGINT");
      assertEquals(order, ["destroy", "shutdown:SIGINT"]);
    });

    it("should call close (full shutdown)", async () => {
      const order: string[] = [];

      @Injectable()
      class Service
        implements
          OnBeforeApplicationShutdown,
          OnModuleDestroy,
          OnApplicationShutdown {
        onBeforeApplicationShutdown() {
          order.push("before");
        }
        onModuleDestroy() {
          order.push("destroy");
        }
        onApplicationShutdown() {
          order.push("shutdown");
        }
      }

      @Module({ providers: [Service] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await ctx.close("SIGTERM");
      assertEquals(order, ["before", "destroy", "shutdown"]);
    });

    it("should collect and throw LifecycleError", async () => {
      @Injectable()
      class FailingService implements OnApplicationBootstrap {
        onApplicationBootstrap() {
          throw new Error("Bootstrap failed!");
        }
      }

      @Module({ providers: [FailingService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await assertRejects(
        () => ctx.onApplicationBootstrap(),
        LifecycleError,
      );
    });

    it("should convert non-Error throws to Error", async () => {
      @Injectable()
      class FailingService implements OnApplicationBootstrap {
        onApplicationBootstrap() {
          throw "string error";
        }
      }

      @Module({ providers: [FailingService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await assertRejects(
        () => ctx.onApplicationBootstrap(),
        LifecycleError,
      );
    });
  });

  describe("InjectorContext lifecycle errors", () => {
    it("should throw LifecycleError on onBeforeApplicationShutdown failure", async () => {
      @Injectable()
      class FailingShutdownService implements OnBeforeApplicationShutdown {
        onBeforeApplicationShutdown() {
          throw new Error("Shutdown prep failed!");
        }
      }

      @Module({ providers: [FailingShutdownService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await assertRejects(
        () => ctx.onBeforeApplicationShutdown(),
        LifecycleError,
      );
    });

    it("should throw LifecycleError on onApplicationShutdown failure (onModuleDestroy)", async () => {
      @Injectable()
      class FailingDestroyService implements OnModuleDestroy {
        onModuleDestroy() {
          throw new Error("Destroy failed!");
        }
      }

      @Module({ providers: [FailingDestroyService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await assertRejects(
        () => ctx.onApplicationShutdown(),
        LifecycleError,
      );
    });

    it("should throw LifecycleError on onApplicationShutdown failure (onApplicationShutdown hook)", async () => {
      @Injectable()
      class FailingShutdownHookService implements OnApplicationShutdown {
        onApplicationShutdown() {
          throw new Error("Shutdown hook failed!");
        }
      }

      @Module({ providers: [FailingShutdownHookService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await assertRejects(
        () => ctx.onApplicationShutdown(),
        LifecycleError,
      );
    });

    it("should convert non-Error throws in onBeforeApplicationShutdown", async () => {
      @Injectable()
      class StringThrowService implements OnBeforeApplicationShutdown {
        onBeforeApplicationShutdown() {
          throw "string error";
        }
      }

      @Module({ providers: [StringThrowService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await assertRejects(
        () => ctx.onBeforeApplicationShutdown(),
        LifecycleError,
      );
    });

    it("should convert non-Error throws in onApplicationShutdown", async () => {
      @Injectable()
      class StringThrowDestroyService implements OnModuleDestroy {
        onModuleDestroy() {
          throw "string error in destroy";
        }
      }

      @Module({ providers: [StringThrowDestroyService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await assertRejects(
        () => ctx.onApplicationShutdown(),
        LifecycleError,
      );
    });
  });

  describe("disposal", () => {
    it("closes the context at the end of an `await using` block", async () => {
      const order: string[] = [];

      @Injectable()
      class Service implements OnBeforeApplicationShutdown, OnModuleDestroy {
        public onBeforeApplicationShutdown(): void {
          order.push("before");
        }

        public onModuleDestroy(): void {
          order.push("destroy");
        }
      }

      @Module({ providers: [Service] })
      class AppModule {}

      {
        await using _ctx = await InjectorContext.create(AppModule);
      }

      assertEquals(order, ["before", "destroy"]);
    });

    it("disposes owned instances after the shutdown hooks, newest first", async () => {
      const order: string[] = [];

      @Injectable()
      class Database implements OnApplicationShutdown, AsyncDisposable {
        public onApplicationShutdown(): void {
          order.push("shutdown:db");
        }

        public [Symbol.asyncDispose](): Promise<void> {
          order.push("dispose:db");
          return Promise.resolve();
        }
      }

      @Injectable()
      class Repository implements Disposable {
        @Inject(Database)
        public readonly db!: Database;

        public [Symbol.dispose](): void {
          order.push("dispose:repo");
        }
      }

      @Module({
        providers: [
          Database,
          Repository,
          {
            provide: "pool",
            useFactory: (): Disposable => ({
              [Symbol.dispose]: () => order.push("dispose:pool"),
            }),
          },
        ],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await ctx.close();

      assertEquals(order, [
        "shutdown:db",
        "dispose:pool",
        "dispose:repo",
        "dispose:db",
      ]);
    });

    it("prefers Symbol.asyncDispose over Symbol.dispose", async () => {
      const calls: string[] = [];

      @Injectable()
      class Both implements AsyncDisposable, Disposable {
        public [Symbol.asyncDispose](): Promise<void> {
          calls.push("async");
          return Promise.resolve();
        }

        public [Symbol.dispose](): void {
          calls.push("sync");
        }
      }

      @Module({ providers: [Both] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await ctx.close();

      assertEquals(calls, ["async"]);
    });

    it("leaves values and aliases to their owner", async () => {
      const disposed: string[] = [];
      const external: Disposable = {
        [Symbol.dispose]: () => disposed.push("value"),
      };

      @Injectable()
      class Owned implements Disposable {
        public [Symbol.dispose](): void {
          disposed.push("owned");
        }
      }

      @Module({
        providers: [
          Owned,
          { provide: "external", useValue: external },
          { provide: "alias", useExisting: Owned },
        ],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      await ctx.close();

      assertEquals(disposed, ["owned"]);
    });

    it("disposes every owned instance and reports failed disposers", async () => {
      const disposed: string[] = [];

      @Injectable()
      class Healthy implements Disposable {
        public [Symbol.dispose](): void {
          disposed.push("healthy");
        }
      }

      @Injectable()
      class Broken implements AsyncDisposable {
        public [Symbol.asyncDispose](): Promise<void> {
          return Promise.reject(new Error("dispose failed"));
        }
      }

      @Module({ providers: [Healthy, Broken] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const error = await assertRejects(() => ctx.close(), LifecycleError);

      assertEquals(disposed, ["healthy"]);
      assertEquals(error.errors.map((e) => e.message), ["dispose failed"]);
    });
  });

  describe("close", () => {
    it("runs the shutdown phase when onBeforeApplicationShutdown fails", async () => {
      const order: string[] = [];

      @Injectable()
      class Service implements OnBeforeApplicationShutdown, OnModuleDestroy {
        public onBeforeApplicationShutdown(): void {
          throw new Error("before failed");
        }

        public onModuleDestroy(): void {
          order.push("destroy");
          throw new Error("destroy failed");
        }
      }

      @Module({ providers: [Service] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const error = await assertRejects(() => ctx.close(), LifecycleError);

      assertEquals(order, ["destroy"]);
      assertEquals(error.phase, "shutdown");
      assertEquals(error.errors.map((e) => e.message), [
        "before failed",
        "destroy failed",
      ]);
    });

    it("shares one shutdown between concurrent calls", async () => {
      const order: string[] = [];
      const { promise: released, resolve: release } = Promise.withResolvers<
        void
      >();

      @Injectable()
      class Service implements OnBeforeApplicationShutdown, OnModuleDestroy {
        public async onBeforeApplicationShutdown(): Promise<void> {
          order.push("before:start");
          await released;
          order.push("before:end");
        }

        public onModuleDestroy(): void {
          order.push("destroy");
        }
      }

      @Module({ providers: [Service] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const first = ctx.close("SIGTERM");
      const second = ctx.close("SIGINT");

      release();
      await Promise.all([first, second]);

      assertEquals(order, ["before:start", "before:end", "destroy"]);
    });

    it("reports errors of overridden phases that are not LifecycleErrors", async () => {
      @Module({})
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      using _before = stub(
        ctx,
        "onBeforeApplicationShutdown",
        () => Promise.reject(new TypeError("phase crashed")),
      );

      const error = await assertRejects(() => ctx.close(), LifecycleError);

      assertEquals(error.errors.map((e) => e.message), ["phase crashed"]);
    });
  });

  describe("beforeInit", () => {
    it("should call sync beforeInit before onModuleInit hooks", async () => {
      const order: string[] = [];

      @Module({})
      class AppModule implements OnModuleInit {
        onModuleInit(): void {
          order.push("onModuleInit");
        }
      }

      await InjectorContext.create(AppModule, {
        beforeInit: () => {
          order.push("beforeInit");
        },
      });

      assertEquals(order, ["beforeInit", "onModuleInit"]);
    });

    it("should await async beforeInit before onModuleInit hooks", async () => {
      const order: string[] = [];

      @Module({})
      class AppModule implements OnModuleInit {
        onModuleInit(): void {
          order.push("onModuleInit");
        }
      }

      await InjectorContext.create(AppModule, {
        beforeInit: async () => {
          await Promise.resolve();
          order.push("beforeInit");
        },
      });

      assertEquals(order, ["beforeInit", "onModuleInit"]);
    });

    it("should receive the constructed InjectorContext instance", async () => {
      let receivedCtx: InjectorContext | undefined;

      @Module({})
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule, {
        beforeInit: (c) => {
          receivedCtx = c;
        },
      });

      assertEquals(receivedCtx, ctx);
    });

    it("should allow registerGlobal so provider is injectable during onModuleInit", async () => {
      const LATE_TOKEN = Symbol("LATE_TOKEN");
      let resolvedValue: string | undefined;

      @Injectable()
      class Consumer {
        @Inject(LATE_TOKEN)
        value!: string;
      }

      @Module({ providers: [Consumer] })
      class AppModule implements OnModuleInit {
        @Inject(Consumer)
        consumer!: Consumer;

        onModuleInit(): void {
          resolvedValue = this.consumer.value;
        }
      }

      await InjectorContext.create(AppModule, {
        beforeInit: (ctx) => {
          ctx.registerGlobal({ provide: LATE_TOKEN, useValue: "injected" });
        },
      });

      assertEquals(resolvedValue, "injected");
    });
  });

  describe("registerGlobal", () => {
    it("should return this for fluent chaining", async () => {
      @Module({})
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const result = ctx.registerGlobal({ provide: "TOKEN", useValue: "val" });

      assertEquals(result, ctx);
    });

    it("should make a single provider resolvable from any module container", async () => {
      const RUNTIME_TOKEN = Symbol("RUNTIME_TOKEN");

      @Module({})
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      ctx.registerGlobal({ provide: RUNTIME_TOKEN, useValue: "runtime" });

      const value = await ctx.resolveInternal<string>(RUNTIME_TOKEN);
      assertEquals(value, "runtime");
    });

    it("should accept multiple providers in a single call", async () => {
      const TOKEN_A = Symbol("TOKEN_A");
      const TOKEN_B = Symbol("TOKEN_B");

      @Module({})
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      ctx.registerGlobal(
        { provide: TOKEN_A, useValue: "a" },
        { provide: TOKEN_B, useValue: "b" },
      );

      const a = await ctx.resolveInternal<string>(TOKEN_A);
      const b = await ctx.resolveInternal<string>(TOKEN_B);
      assertEquals(a, "a");
      assertEquals(b, "b");
    });
  });

  describe("InjectorContext buildContainer cache", () => {
    it("should reuse containers for shared imports", async () => {
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class SharedModule {}

      @Module({ imports: [SharedModule], exports: [SimpleService] })
      class ModuleA {}

      @Module({ imports: [SharedModule], exports: [SimpleService] })
      class ModuleB {}

      @Module({ imports: [ModuleA, ModuleB], exports: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(SimpleService);
      assertExists(service);
    });

    it("initializes the imports of a dynamic variant built after its static module", async () => {
      const initialized: string[] = [];

      @Injectable()
      class ExtraService implements OnModuleInit {
        public onModuleInit(): void {
          initialized.push("extra");
        }
      }

      @Module({ providers: [ExtraService] })
      class ExtraModule {}

      @Module({})
      class HybridModule {
        public static forRoot(): DynamicModule {
          return { module: HybridModule, imports: [ExtraModule] };
        }
      }

      @Module({ imports: [HybridModule] })
      class FeatureModule {}

      @Module({ imports: [FeatureModule, HybridModule.forRoot()] })
      class AppModule {}

      await InjectorContext.create(AppModule);

      assertEquals(initialized, ["extra"]);
    });
  });

  describe("ModuleCompiler global providers", () => {
    it("should collect and use global providers", async () => {
      @Injectable()
      class GlobalOnlyService {
        value = "global-only";
      }

      @Global()
      @Module({ providers: [GlobalOnlyService], exports: [GlobalOnlyService] })
      class GlobalModuleWithProviders {}

      @Injectable()
      class ConsumerService {
        @Inject(GlobalOnlyService)
        globalService!: GlobalOnlyService;
      }

      @Module({ providers: [ConsumerService], exports: [ConsumerService] })
      class ConsumerModule {}

      @Module({
        imports: [GlobalModuleWithProviders, ConsumerModule],
        exports: [ConsumerService],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const consumer = await ctx.resolve(ConsumerService);

      assertEquals(consumer.globalService.value, "global-only");
    });
  });

  describe("global modules", () => {
    const NAME = Symbol("NAME");
    const GREETING = Symbol("GREETING");

    @Module({
      providers: [{ provide: NAME, useValue: "denorid" }],
      exports: [NAME],
    })
    class NameModule {}

    @Injectable()
    class Greeter {
      @Inject(NAME)
      public name!: string;
    }

    @Module({})
    class GreetingModule {
      public static forRoot(): DynamicModule {
        return {
          module: GreetingModule,
          global: true,
          imports: [NameModule],
          providers: [
            Greeter,
            {
              provide: GREETING,
              useFactory: (name: string) => `hello ${name}`,
              inject: [NAME],
            },
          ],
          exports: [Greeter, GREETING],
        };
      }
    }

    @Injectable()
    class Consumer {
      @Inject(GREETING)
      public greeting!: string;

      @Inject(Greeter)
      public greeter!: Greeter;
    }

    @Module({ providers: [Consumer], exports: [Consumer] })
    class ConsumerModule {}

    it("resolves dependencies of global providers through the module's imports", async () => {
      @Module({
        imports: [ConsumerModule, GreetingModule.forRoot()],
        exports: [Consumer],
      })
      class AppModule {}

      using errorStub = stub(Logger.prototype, "error");

      const ctx = await InjectorContext.create(AppModule);
      const consumer = await ctx.resolve(Consumer);

      assertEquals(consumer.greeting, "hello denorid");
      assertEquals(consumer.greeter.name, "denorid");
      assertEquals(errorStub.calls.length, 0);
    });

    it("does not expose the imports of global modules", async () => {
      @Module({
        providers: [{
          provide: "LEAKED",
          useFactory: (name: string) => name,
          inject: [NAME],
        }],
        exports: ["LEAKED"],
      })
      class LeakModule {}

      @Module({
        imports: [GreetingModule.forRoot(), LeakModule],
        exports: ["LEAKED"],
      })
      class AppModule {}

      using _errorStub = stub(Logger.prototype, "error");

      const ctx = await InjectorContext.create(AppModule);

      await assertRejects(() => ctx.resolve("LEAKED"), TokenNotFoundError);
    });
  });

  describe("factory dependencies", () => {
    it("resolves shared dependencies regardless of provider order", async () => {
      const A = Symbol("A");
      const B = Symbol("B");
      const C = Symbol("C");

      @Module({
        providers: [
          {
            provide: A,
            useFactory: (b: string, c: string) => `a(${b},${c})`,
            inject: [B, C],
          },
          { provide: B, useFactory: (c: string) => `b(${c})`, inject: [C] },
          { provide: C, useValue: "c" },
        ],
        exports: [A],
      })
      class AppModule {}

      using errorStub = stub(Logger.prototype, "error");

      const ctx = await InjectorContext.create(AppModule);

      assertEquals(await ctx.resolve<string>(A), "a(b(c),c)");
      assertEquals(errorStub.calls.length, 0);
    });
  });

  describe("Dynamic module with static metadata", () => {
    it("should merge static and dynamic metadata", async () => {
      @Module({
        providers: [{ provide: "STATIC_PROVIDER", useValue: "from_static" }],
        exports: ["STATIC_PROVIDER"],
      })
      class HybridModule {
        static forRoot(): DynamicModule {
          return {
            module: HybridModule,
            providers: [{
              provide: "DYNAMIC_PROVIDER",
              useValue: "from_dynamic",
            }],
            exports: ["DYNAMIC_PROVIDER"],
          };
        }
      }

      @Module({
        imports: [HybridModule.forRoot()],
        exports: ["STATIC_PROVIDER", "DYNAMIC_PROVIDER"],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      const staticVal = await ctx.resolve<string>("STATIC_PROVIDER");
      const dynamicVal = await ctx.resolve<string>("DYNAMIC_PROVIDER");

      assertEquals(staticVal, "from_static");
      assertEquals(dynamicVal, "from_dynamic");
    });
  });

  describe("InjectorContext init error handling", () => {
    it("logs providers that fail to resolve during init and continues", async () => {
      @Injectable()
      class FailingInitService {
        @Inject("MISSING_DEP")
        dep!: unknown;
      }

      @Module({
        providers: [FailingInitService, SimpleService],
        exports: [SimpleService],
      })
      class AppModule {}

      using errorStub = stub(Logger.prototype, "error");

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(SimpleService);
      const initFailure = errorStub.calls.find(({ args }) =>
        String(args[0]).startsWith("Failed to initialize FailingInitService:")
      );

      assertExists(service);
      assertExists(initFailure);
      assertStringIncludes(String(initFailure.args[0]), "MISSING_DEP");
      assertEquals(typeof initFailure.args[1], "string");
    });

    it("logs errors thrown by onModuleInit hooks", async () => {
      @Injectable()
      class FailingHookService implements OnModuleInit {
        onModuleInit(): void {
          throw new Error("hook exploded");
        }
      }

      @Module({ providers: [FailingHookService] })
      class AppModule {}

      using errorStub = stub(Logger.prototype, "error");

      await InjectorContext.create(AppModule);

      assertEquals(errorStub.calls.length, 1);
      assertEquals(
        errorStub.calls[0].args[0],
        "Failed to initialize FailingHookService: hook exploded",
      );
      assertStringIncludes(String(errorStub.calls[0].args[1]), "hook exploded");
    });

    it("wraps non-Error values thrown during init", async () => {
      @Injectable()
      class StringThrowHookService implements OnModuleInit {
        onModuleInit(): void {
          throw "plain failure";
        }
      }

      @Module({ providers: [StringThrowHookService] })
      class AppModule {}

      using errorStub = stub(Logger.prototype, "error");

      await InjectorContext.create(AppModule);

      assertEquals(errorStub.calls.length, 1);
      assertEquals(
        errorStub.calls[0].args[0],
        "Failed to initialize StringThrowHookService: plain failure",
      );
    });
  });

  describe("InjectorContext onApplicationShutdown string throw", () => {
    it("should convert non-Error throws in onApplicationShutdown hook", async () => {
      @Injectable()
      class StringThrowShutdownService implements OnApplicationShutdown {
        onApplicationShutdown() {
          throw "string error in shutdown hook";
        }
      }

      @Module({ providers: [StringThrowShutdownService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      await assertRejects(
        () => ctx.onApplicationShutdown(),
        LifecycleError,
      );
    });
  });

  describe("global module instances", () => {
    it("shares one instance between importing and non-importing modules", async () => {
      let created = 0;

      @Injectable()
      class GlobalService {
        public readonly id = ++created;
      }

      @Global()
      @Module({ providers: [GlobalService], exports: [GlobalService] })
      class GlobalModule {}

      @Injectable()
      class FeatureService {
        @Inject(GlobalService)
        public global!: GlobalService;
      }

      @Module({ providers: [FeatureService], exports: [FeatureService] })
      class FeatureModule {}

      @Module({
        imports: [GlobalModule, FeatureModule],
        exports: [GlobalService, FeatureService],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const feature = await ctx.resolve(FeatureService);

      assertStrictEquals(feature.global, await ctx.resolve(GlobalService));
      assertEquals(created, 1);
    });

    it("reports and forwards the mode of global providers", async () => {
      @Global()
      @Module({ providers: [TransientService], exports: [TransientService] })
      class GlobalModule {}

      @Module({ providers: [ServiceWithModuleRef] })
      class FeatureModule {}

      @Module({ imports: [GlobalModule, FeatureModule] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const { moduleRef } = await ctx.resolveInternal(ServiceWithModuleRef);
      const options = { contextId: "ctx-1", strict: false };
      const first = await moduleRef.get(TransientService, options);

      assertEquals(
        ctx.container.getProviderMode(TransientService),
        "transient",
      );
      assertStrictEquals(await moduleRef.get(TransientService, options), first);
      assert(
        first !== await moduleRef.get(TransientService, { strict: false }),
      );
    });

    it("lists a tagged global module provider once", async () => {
      @Global()
      @Module({ providers: [TaggedServiceA], exports: [TaggedServiceA] })
      class GlobalModule {}

      @Module({ imports: [GlobalModule] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      assertEquals(ctx.container.getTokensByTag(TAG_A, true), [
        TaggedServiceA,
      ]);
      assertEquals(
        (await ctx.getHostModuleRef().getByTag(TAG_A, { strict: false }))
          .length,
        1,
      );
    });

    it("initializes, bootstraps and disposes the global copy of a dropped global variant", async () => {
      const calls: string[] = [];
      const NAME = Symbol("NAME");

      @Module({
        providers: [{ provide: NAME, useValue: "host" }],
        exports: [NAME],
      })
      class NameModule {}

      @Injectable()
      class HostService
        implements OnModuleInit, OnApplicationBootstrap, Disposable {
        @Inject(NAME)
        public name!: string;

        public constructor(public readonly ref: ModuleRef) {}

        public onModuleInit(): void {
          calls.push("init");
        }

        public onApplicationBootstrap(): void {
          calls.push("bootstrap");
        }

        public [Symbol.dispose](): void {
          calls.push("dispose");
        }
      }

      @Module({})
      class HostModule {}

      @Injectable()
      class Consumer {
        @Inject(HostService)
        public host!: HostService;
      }

      @Module({ providers: [Consumer], exports: [Consumer] })
      class ConsumerModule {}

      @Module({
        imports: [
          HostModule,
          {
            module: HostModule,
            global: true,
            imports: [NameModule],
            providers: [HostService],
          },
          ConsumerModule,
        ],
        exports: [Consumer],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const { host } = await ctx.resolve(Consumer);

      assertEquals(calls, ["init"]);
      assertEquals(host.name, "host");
      assertStrictEquals(await host.ref.get(HostService), host);

      await ctx.onApplicationBootstrap();
      await ctx.close();

      assertEquals(calls, ["init", "bootstrap", "dispose"]);
    });

    it("runs hooks on providers registered globally, never on the context itself", async () => {
      const calls: string[] = [];

      @Injectable()
      class GlobalHooks implements OnApplicationBootstrap, OnModuleDestroy {
        public onApplicationBootstrap(): void {
          calls.push("bootstrap");
        }

        public onModuleDestroy(): void {
          calls.push("destroy");
        }
      }

      @Injectable()
      class Consumer {
        @Inject(GlobalHooks)
        public hooks!: GlobalHooks;

        @Inject(InjectorContext)
        public ctx!: InjectorContext;
      }

      @Module({ providers: [Consumer] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule, {
        beforeInit: (ctx) => {
          ctx.registerGlobal(GlobalHooks, {
            provide: InjectorContext,
            useValue: ctx,
          });
        },
      });

      assertStrictEquals((await ctx.resolveInternal(Consumer)).ctx, ctx);

      await ctx.onApplicationBootstrap();
      await ctx.close();

      assertEquals(calls, ["bootstrap", "destroy"]);
    });
  });

  describe("aliases during init", () => {
    it("skips an alias of a request-scoped provider and keeps it per request", async () => {
      @Module({
        providers: [RequestScopedService, {
          provide: "ALIAS",
          useExisting: RequestScopedService,
        }],
      })
      class AppModule {}

      using errorStub = stub(Logger.prototype, "error");

      const ctx = await InjectorContext.create(AppModule);
      const resolve = (id: string): Promise<RequestScopedService> =>
        ctx.runInRequestScopeAsync(id, () => ctx.resolveInternal("ALIAS"));

      assertEquals(errorStub.calls.length, 0);
      assert((await resolve("req-1")).id !== (await resolve("req-2")).id);
    });
  });

  describe("transient providers", () => {
    it("are neither initialized nor tracked for lifecycle hooks", async () => {
      const calls: string[] = [];

      @Injectable({ mode: "transient" })
      class Worker
        implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
        public onModuleInit(): void {
          calls.push("init");
        }

        public onApplicationBootstrap(): void {
          calls.push("bootstrap");
        }

        public onModuleDestroy(): void {
          calls.push("destroy");
        }
      }

      @Module({ providers: [Worker], exports: [Worker] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      await ctx.resolve(Worker);
      await ctx.resolveWithinContext(Worker, "ctx-1");
      ctx.clearContext("ctx-1");
      await ctx.onApplicationBootstrap();
      await ctx.close();

      assertEquals(calls, []);
    });
  });

  describe("clearContext across modules", () => {
    it("releases the context cache of imported modules", async () => {
      @Module({ providers: [TransientService], exports: [TransientService] })
      class FeatureModule {}

      @Module({ imports: [FeatureModule] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const first = await ctx.resolveWithinContext(TransientService, "ctx-1");

      assertStrictEquals(
        await ctx.resolveWithinContext(TransientService, "ctx-1"),
        first,
      );

      ctx.clearContext("ctx-1");

      assert(
        first !== await ctx.resolveWithinContext(TransientService, "ctx-1"),
      );
    });
  });

  describe("constructor-injected ModuleRef", () => {
    it("belongs to the module declaring a provider resolved after init", async () => {
      @Injectable({ mode: "request" })
      class RequestService {
        public constructor(public readonly ref?: ModuleRef) {}
      }

      @Module({ providers: [RequestService], exports: [RequestService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.runInRequestScopeAsync(
        "req-1",
        () => ctx.resolve(RequestService),
      );

      assertStrictEquals(service.ref, ctx.getHostModuleRef());
    });

    it("belongs to the declaring module when another module resolves the provider", async () => {
      const LIB_DEP = Symbol("LIB_DEP");

      @Injectable({ mode: "transient" })
      class LibHelper {
        public constructor(public readonly ref: ModuleRef) {}
      }

      @Module({
        providers: [LibHelper, { provide: LIB_DEP, useValue: "lib" }],
        exports: [LibHelper],
      })
      class LibModule {}

      @Injectable()
      class AppService {
        @Inject(LibHelper)
        public helper!: LibHelper;
      }

      @Module({
        imports: [LibModule],
        providers: [AppService],
        exports: [AppService],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const { helper } = await ctx.resolve(AppService);

      assertEquals(await helper.ref.get(LIB_DEP), "lib");
      assert(!helper.ref.has(AppService));
    });
  });

  describe("lifecycle order across modules", () => {
    it("bootstraps dependencies first and tears them down last", async () => {
      const order: string[] = [];

      class Tracked
        implements
          OnModuleInit,
          OnApplicationBootstrap,
          OnBeforeApplicationShutdown,
          OnModuleDestroy,
          OnApplicationShutdown,
          Disposable {
        public constructor(private readonly name: string) {}

        public onModuleInit(): void {
          order.push(`init:${this.name}`);
        }

        public onApplicationBootstrap(): void {
          order.push(`bootstrap:${this.name}`);
        }

        public onBeforeApplicationShutdown(): void {
          order.push(`before:${this.name}`);
        }

        public onModuleDestroy(): void {
          order.push(`destroy:${this.name}`);
        }

        public onApplicationShutdown(): void {
          order.push(`shutdown:${this.name}`);
        }

        public [Symbol.dispose](): void {
          order.push(`dispose:${this.name}`);
        }
      }

      @Injectable()
      class DbService extends Tracked {
        public constructor() {
          super("db");
        }
      }

      @Module({ providers: [DbService], exports: [DbService] })
      class DbModule {}

      @Injectable()
      class AppService extends Tracked {
        @Inject(DbService)
        public db!: DbService;

        public constructor() {
          super("app");
        }
      }

      @Module({ imports: [DbModule], providers: [AppService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      await ctx.onApplicationBootstrap();
      await ctx.close();

      assertEquals(order, [
        "init:db",
        "init:app",
        "bootstrap:db",
        "bootstrap:app",
        "before:app",
        "before:db",
        "destroy:app",
        "destroy:db",
        "shutdown:app",
        "shutdown:db",
        "dispose:app",
        "dispose:db",
      ]);
    });

    it("runs hooks on the imports of a dropped module variant", async () => {
      const calls: string[] = [];

      @Injectable()
      class ExtraService implements OnApplicationBootstrap, OnModuleDestroy {
        public onApplicationBootstrap(): void {
          calls.push("bootstrap");
        }

        public onModuleDestroy(): void {
          calls.push("destroy");
        }
      }

      @Module({ providers: [ExtraService] })
      class ExtraModule {}

      @Module({})
      class HybridModule {
        public static forRoot(): DynamicModule {
          return { module: HybridModule, imports: [ExtraModule] };
        }
      }

      @Module({ imports: [HybridModule, HybridModule.forRoot()] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);

      await ctx.onApplicationBootstrap();
      await ctx.close();

      assertEquals(calls, ["bootstrap", "destroy"]);
    });
  });

  describe("tryResolve errors", () => {
    it("rethrows errors other than TokenNotFoundError", async () => {
      @Module({
        providers: [{
          provide: "BROKEN",
          useFactory: (): never => {
            throw new TypeError("factory crashed");
          },
        }],
        exports: ["BROKEN"],
      })
      class AppModule {}

      using _errorStub = stub(Logger.prototype, "error");

      const ctx = await InjectorContext.create(AppModule);

      await assertRejects(
        () => ctx.tryResolve("BROKEN"),
        TypeError,
        "factory crashed",
      );
      assertEquals(await ctx.tryResolve("MISSING"), undefined);
    });
  });

  describe("shutdown", () => {
    it("clears every container and runs the hooks once", async () => {
      const calls: string[] = [];

      @Injectable()
      class ChildService implements OnModuleDestroy {
        public onModuleDestroy(): void {
          calls.push("destroy");
        }
      }

      @Module({ providers: [ChildService], exports: [ChildService] })
      class ChildModule {}

      @Module({ imports: [ChildModule], exports: [ChildService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule, {
        beforeInit: (ctx) => {
          ctx.registerGlobal({ provide: "GLOBAL", useValue: "global" });
        },
      });

      await ctx.close();
      await ctx.onApplicationShutdown();

      assertEquals(calls, ["destroy"]);
      await assertRejects(() => ctx.resolve(ChildService), TokenNotFoundError);
      await assertRejects(() => ctx.resolve("GLOBAL"), TokenNotFoundError);
    });
  });

  describe("module graph resolution", () => {
    const TAG = Symbol("GRAPH_TAG");

    @Injectable()
    @Tags(TAG)
    class HiddenService {}

    @Module({ providers: [HiddenService] })
    class HiddenModule {}

    @Module({ imports: [HiddenModule] })
    class MiddleModule {}

    @Module({ imports: [MiddleModule], providers: [ServiceWithModuleRef] })
    class AppModule {}

    it("resolves providers of nested non-exported modules internally", async () => {
      const ctx = await InjectorContext.create(AppModule);
      const { moduleRef } = await ctx.resolveInternal(ServiceWithModuleRef);
      const hidden = await ctx.resolveInternal(HiddenService);

      assertInstanceOf(hidden, HiddenService);
      assertStrictEquals(
        await moduleRef.get(HiddenService, { strict: false }),
        hidden,
      );
      assert(moduleRef.hasGlobal(HiddenService));
      assert(!moduleRef.hasGlobal("UNKNOWN"));
      await assertRejects(() => ctx.resolve(HiddenService), TokenNotFoundError);
      await assertRejects(
        () => moduleRef.get("UNKNOWN", { strict: false }),
        TokenNotFoundError,
      );
    });

    it("discovers tagged providers of nested non-exported modules", async () => {
      const ctx = await InjectorContext.create(AppModule);
      const moduleRef = ctx.getHostModuleRef();

      assertEquals(ctx.container.getTokensByTag(TAG, true), [HiddenService]);
      assertEquals(moduleRef.getTokensByTag(TAG, { strict: false }), [
        HiddenService,
      ]);
      assertStrictEquals(
        (await moduleRef.getByTag(TAG, { strict: false }))[0],
        await ctx.resolveInternal(HiddenService),
      );
    });

    it("skips tagged providers that cannot be resolved", async () => {
      const BROKEN_TAG = Symbol("BROKEN_TAG");

      @Injectable()
      @Tags(BROKEN_TAG)
      class Missing {
        @Inject("MISSING")
        public missing!: unknown;
      }

      @Injectable()
      @Tags(BROKEN_TAG)
      class Crashing {
        public constructor() {
          throw new TypeError("crashed");
        }
      }

      @Module({ providers: [Missing] })
      class MissingModule {}

      @Module({ providers: [Crashing] })
      class CrashingModule {}

      @Module({ imports: [MissingModule] })
      class SkippingModule {}

      @Module({ imports: [MissingModule, CrashingModule] })
      class FailingModule {}

      using _errorStub = stub(Logger.prototype, "error");

      const skipping = await InjectorContext.create(SkippingModule);
      const failing = await InjectorContext.create(FailingModule);

      assertEquals(
        await skipping.getHostModuleRef().getByTag(BROKEN_TAG, {
          strict: false,
        }),
        [],
      );
      await assertRejects(
        () =>
          failing.getHostModuleRef().getByTag(BROKEN_TAG, { strict: false }),
        TypeError,
        "crashed",
      );
    });
  });

  describe("overrides", () => {
    it("replaces providers of nested and global modules", async () => {
      const NESTED = Symbol("NESTED");
      const GLOBAL = Symbol("GLOBAL");

      @Module({
        providers: [{ provide: NESTED, useValue: "original" }],
        exports: [NESTED],
      })
      class NestedModule {}

      @Global()
      @Module({
        providers: [{ provide: GLOBAL, useValue: "original" }],
        exports: [GLOBAL],
      })
      class GlobalModule {}

      @Module({ imports: [NestedModule, GlobalModule] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule, {
        overrides: [
          { provide: NESTED, useValue: "first" },
          { provide: NESTED, useValue: "nested" },
          { provide: GLOBAL, useValue: "global" },
          { provide: "UNDECLARED", useValue: "ignored" },
        ],
      });

      assertEquals(await ctx.resolve(NESTED), "nested");
      assertEquals(await ctx.resolve(GLOBAL), "global");
      assertEquals(await ctx.tryResolve("UNDECLARED"), undefined);
    });
  });

  describe("scope bubbling", () => {
    it("makes a singleton controller of a request-scoped state request-scoped", async () => {
      const calls: string[] = [];

      @Injectable({ mode: "request" })
      class RequestState {
        public readonly id = crypto.randomUUID();
      }

      @Injectable()
      class ItemsController implements OnModuleInit, OnModuleDestroy {
        @Inject(RequestState)
        public state!: RequestState;

        public onModuleInit(): void {
          calls.push("init");
        }

        public onModuleDestroy(): void {
          calls.push("destroy");
        }
      }

      @Module({
        providers: [RequestState, ItemsController],
        exports: [ItemsController],
      })
      class AppModule {}

      using errorStub = stub(Logger.prototype, "error");

      const ctx = await InjectorContext.create(AppModule);
      const ids = await Promise.all(
        ["req-1", "req-2"].map((id) =>
          ctx.runInRequestScopeAsync(
            id,
            async () => (await ctx.resolve(ItemsController)).state.id,
          )
        ),
      );

      assert(ctx.container.isRequestScoped(ItemsController));

      await ctx.onApplicationBootstrap();
      await ctx.close();

      assertEquals(errorStub.calls.length, 0);
      assert(ids[0] !== ids[1]);
      assertEquals(calls, []);
    });

    it("bubbles across exported and global modules", async () => {
      @Injectable({ mode: "request" })
      class GlobalState {
        public readonly id = crypto.randomUUID();
      }

      @Global()
      @Module({ providers: [GlobalState], exports: [GlobalState] })
      class GlobalStateModule {}

      @Module({
        providers: [RequestScopedService],
        exports: [RequestScopedService],
      })
      class StateModule {}

      @Injectable()
      class ViaImport {
        @Inject(RequestScopedService)
        public state!: RequestScopedService;
      }

      @Injectable()
      class ViaGlobal {
        @Inject(GlobalState)
        public state!: GlobalState;
      }

      @Module({
        imports: [StateModule],
        providers: [ViaImport],
        exports: [ViaImport],
      })
      class ImportingModule {}

      @Module({ providers: [ViaGlobal], exports: [ViaGlobal] })
      class FeatureModule {}

      @Module({
        imports: [GlobalStateModule, ImportingModule, FeatureModule],
        exports: [ViaImport, ViaGlobal],
      })
      class AppModule {}

      using errorStub = stub(Logger.prototype, "error");

      const ctx = await InjectorContext.create(AppModule);
      const [first, second] = await Promise.all(
        ["req-1", "req-2"].map((id) =>
          ctx.runInRequestScopeAsync(id, async () => [
            (await ctx.resolve(ViaImport)).state.id,
            (await ctx.resolve(ViaGlobal)).state.id,
          ])
        ),
      );

      assertEquals(errorStub.calls.length, 0);
      assert(ctx.container.isRequestScoped(ViaImport));
      assert(ctx.container.isRequestScoped(ViaGlobal));
      assert(first[0] !== second[0]);
      assert(first[1] !== second[1]);
    });
  });
});

describe("Critical coverage tests (run first)", () => {
  it("should handle global module with undefined providers array", async () => {
    @Global()
    @Module({ exports: [] })
    class GlobalModuleNoProviders {}

    @Module({ imports: [GlobalModuleNoProviders] })
    class AppModule {}

    const ctx = await InjectorContext.create(AppModule);

    assertExists(ctx);
  });

  it("should handle dynamic module with no static @Module decorator", async () => {
    class BareClass {}

    const dynamicMod: DynamicModule = {
      module: BareClass as Type,
      providers: [{ provide: "TEST", useValue: "test" }],
      exports: ["TEST"],
    };

    @Module({ imports: [dynamicMod], exports: ["TEST"] })
    class AppModule {}

    const ctx = await InjectorContext.create(AppModule);
    const value = await ctx.resolve<string>("TEST");
    assertEquals(value, "test");
  });

  it("should handle dynamic module with undefined providers array", async () => {
    @Module({
      providers: [{ provide: "STATIC_ONLY", useValue: "static" }],
      exports: ["STATIC_ONLY"],
    })
    class HybridModule {
      static forRoot(): DynamicModule {
        return {
          module: HybridModule,
          exports: ["STATIC_ONLY"],
        };
      }
    }

    @Module({ imports: [HybridModule.forRoot()], exports: ["STATIC_ONLY"] })
    class AppModule {}

    const ctx = await InjectorContext.create(AppModule);
    const value = await ctx.resolve<string>("STATIC_ONLY");
    assertEquals(value, "static");
  });

  it("should handle factory provider with class token that has no @Injectable metadata", async () => {
    class PlainClass {
      value = "plain";
    }

    const container = new Container(noopLogger);

    container.register({
      provide: PlainClass,
      useFactory: () => new PlainClass(),
    });

    assertEquals(container.getProviderMode(PlainClass), "singleton");

    const instance = await container.resolve(PlainClass);
    assertEquals(instance.value, "plain");
  });

  it("should hit global provider collection in _module_compiler", async () => {
    @Injectable()
    class FirstGlobalService {
      value = "first-global";
    }

    @Global()
    @Module({
      providers: [FirstGlobalService],
      exports: [FirstGlobalService],
    })
    class FirstGlobalModule {}

    @Injectable()
    class FirstConsumer {
      @Inject(FirstGlobalService)
      service!: FirstGlobalService;
    }

    @Module({
      providers: [FirstConsumer],
      exports: [FirstConsumer],
    })
    class FirstConsumerModule {}

    @Module({
      imports: [FirstGlobalModule, FirstConsumerModule],
      exports: [FirstConsumer],
    })
    class FirstAppModule {}

    const ctx = await InjectorContext.create(FirstAppModule);
    const consumer = await ctx.resolve(FirstConsumer);
    assertEquals(consumer.service.value, "first-global");
  });

  it("should hit dynamic module static metadata merge in _module_compiler", async () => {
    @Module({
      providers: [{ provide: "FIRST_STATIC", useValue: "static-first" }],
      exports: ["FIRST_STATIC"],
    })
    class FirstHybridModule {
      static forRoot(): DynamicModule {
        return {
          module: FirstHybridModule,
          providers: [{ provide: "FIRST_DYNAMIC", useValue: "dynamic-first" }],
          exports: ["FIRST_DYNAMIC"],
        };
      }
    }

    @Module({
      imports: [FirstHybridModule.forRoot()],
      exports: ["FIRST_STATIC", "FIRST_DYNAMIC"],
    })
    class FirstHybridAppModule {}

    const ctx = await InjectorContext.create(FirstHybridAppModule);
    const staticVal = await ctx.resolve<string>("FIRST_STATIC");
    const dynamicVal = await ctx.resolve<string>("FIRST_DYNAMIC");

    assertEquals(staticVal, "static-first");
    assertEquals(dynamicVal, "dynamic-first");
  });

  it("should hit factory provider mode inheritance in _normalized_provider", async () => {
    @Injectable({ mode: "transient" })
    class FirstTransientTarget {
      id = crypto.randomUUID();
    }

    const container = new Container(noopLogger);

    container.register({
      provide: FirstTransientTarget,
      useFactory: () => new FirstTransientTarget(),
    });

    const mode = container.getProviderMode(FirstTransientTarget);
    assertEquals(mode, "transient");

    const a = await container.resolve(FirstTransientTarget);
    const b = await container.resolve(FirstTransientTarget);
    assert(a.id !== b.id, "Transient instances should have different IDs");
  });
});
