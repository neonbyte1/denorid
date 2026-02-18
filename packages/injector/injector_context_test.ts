import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { RequestScopedService, SimpleService } from "./_test_fixtures.ts";
import type { Type } from "./common.ts";
import { Container } from "./container.ts";
import { Global, Inject, Injectable, Module } from "./decorators.ts";
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

    it("should throw for non-exported own token", async () => {
      @Module({ providers: [SimpleService] })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      assertThrows(
        () => ctx.resolve(SimpleService),
        TokenNotFoundError,
      );
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
    it("should silently skip providers that fail to resolve during init", async () => {
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

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(SimpleService);

      assertExists(service);
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

    const container = new Container();

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

    const container = new Container();

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
