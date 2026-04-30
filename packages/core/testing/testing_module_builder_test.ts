import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnBeforeApplicationShutdown,
  OnModuleInit,
} from "@denorid/injector";
import { Inject, Injectable, InjectorContext, Module } from "@denorid/injector";
import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { afterEach, describe, it } from "@std/testing/bdd";
import { ExceptionHandler } from "../exceptions/handler.ts";
import type { TestingModule } from "./testing_module.ts";
import { Test, TestingModuleBuilder } from "./testing_module_builder.ts";

describe(TestingModuleBuilder.name, () => {
  let module: TestingModule | undefined;

  afterEach(async () => {
    await module?.close();
    module = undefined;
  });

  describe("compile()", () => {
    it("compiles with no metadata", async () => {
      module = await Test.createTestingModule({}).compile();

      assertInstanceOf(module, Object);
    });

    it("resolves a flat class provider", async () => {
      @Injectable()
      class MyService {
        value = 42;
      }

      module = await Test.createTestingModule({
        providers: [MyService],
      }).compile();

      const svc = await module.get(MyService);

      assertInstanceOf(svc, MyService);
      assertEquals(svc.value, 42);
    });

    it("resolves a value provider", async () => {
      const TOKEN = Symbol("token");

      module = await Test.createTestingModule({
        providers: [{ provide: TOKEN, useValue: "hello" }],
      }).compile();

      const value = await module.get<string>(TOKEN);

      assertEquals(value, "hello");
    });

    it("resolves a factory provider", async () => {
      const TOKEN = Symbol("factory");

      module = await Test.createTestingModule({
        providers: [{ provide: TOKEN, useFactory: () => ({ computed: true }) }],
      }).compile();

      const value = await module.get<{ computed: boolean }>(TOKEN);

      assertEquals(value, { computed: true });
    });

    it("resolves providers from imported modules", async () => {
      @Injectable()
      class SharedService {
        name = "shared";
      }

      @Module({ providers: [SharedService], exports: [SharedService] })
      class SharedModule {}

      module = await Test.createTestingModule({
        imports: [SharedModule],
      }).compile();

      const svc = await module.get(SharedService);

      assertInstanceOf(svc, SharedService);
      assertEquals(svc.name, "shared");
    });
  });

  describe("overrideProvider()", () => {
    it("useValue() replaces a provider with a static value", async () => {
      @Injectable()
      class RealService {
        greet(): string {
          return "real";
        }
      }

      module = await Test.createTestingModule({
        providers: [RealService],
      })
        .overrideProvider(RealService)
        .useValue({ greet: () => "mock" })
        .compile();

      const svc = await module.get<RealService>(RealService);

      assertEquals(svc.greet(), "mock");
    });

    it("useClass() replaces a provider with a different class", async () => {
      @Injectable()
      class RealService {
        greet(): string {
          return "real";
        }
      }

      @Injectable()
      class MockService {
        greet(): string {
          return "mock";
        }
      }

      module = await Test.createTestingModule({
        providers: [RealService],
      })
        .overrideProvider(RealService)
        .useClass(MockService)
        .compile();

      const svc = await module.get<RealService>(RealService);

      assertEquals(svc.greet(), "mock");
    });

    it("useFactory() replaces a provider with a factory result", async () => {
      @Injectable()
      class RealService {
        greet(): string {
          return "real";
        }
      }

      module = await Test.createTestingModule({
        providers: [RealService],
      })
        .overrideProvider(RealService)
        .useFactory(() => ({ greet: () => "factory" }))
        .compile();

      const svc = await module.get<RealService>(RealService);

      assertEquals(svc.greet(), "factory");
    });

    it("useFactory() injects declared dependencies into the factory", async () => {
      const CONFIG = Symbol("config");

      module = await Test.createTestingModule({
        providers: [
          { provide: CONFIG, useValue: { env: "test" } },
          {
            provide: "RESULT",
            useFactory: (cfg: { env: string }) => cfg.env,
            inject: [CONFIG],
          },
        ],
      }).compile();

      const result = await module.get<string>("RESULT");

      assertEquals(result, "test");
    });

    it("override wins over the original provider", async () => {
      const TOKEN = Symbol("tok");

      module = await Test.createTestingModule({
        providers: [{ provide: TOKEN, useValue: "original" }],
      })
        .overrideProvider(TOKEN)
        .useValue("overridden")
        .compile();

      const value = await module.get<string>(TOKEN);

      assertEquals(value, "overridden");
    });

    it("multiple overrides accumulate independently", async () => {
      const A = Symbol("A");
      const B = Symbol("B");

      module = await Test.createTestingModule({
        providers: [
          { provide: A, useValue: 1 },
          { provide: B, useValue: 2 },
        ],
      })
        .overrideProvider(A)
        .useValue(10)
        .overrideProvider(B)
        .useValue(20)
        .compile();

      assertEquals(await module.get<number>(A), 10);
      assertEquals(await module.get<number>(B), 20);
    });
  });

  describe("useMocker()", () => {
    it("auto-mocks @Inject field dependencies that are not declared", async () => {
      const DEP = Symbol("dep");

      @Injectable()
      class ServiceWithDep {
        @Inject(DEP)
        dep!: { value: number };
      }

      module = await Test.createTestingModule({
        providers: [ServiceWithDep],
      })
        .useMocker((_token) => ({ value: 99 }))
        .compile();

      const svc = await module.get(ServiceWithDep);

      assertEquals(svc.dep, { value: 99 });
    });

    it("does not mock tokens that are already declared", async () => {
      const DEP = Symbol("dep");
      let mockerCalled = false;

      @Injectable()
      class ServiceWithDep {
        @Inject(DEP)
        dep!: { value: number };
      }

      module = await Test.createTestingModule({
        providers: [
          ServiceWithDep,
          { provide: DEP, useValue: { value: 1 } },
        ],
      })
        .useMocker((_token) => {
          mockerCalled = true;
          return {};
        })
        .compile();

      assertEquals(mockerCalled, false);
    });

    it("does not scan value providers for dependencies", async () => {
      const TOKEN = Symbol("val");
      let mockerCalled = false;

      module = await Test.createTestingModule({
        providers: [{ provide: TOKEN, useValue: { a: 1 } }],
      })
        .useMocker((_token) => {
          mockerCalled = true;
          return {};
        })
        .compile();

      assertEquals(mockerCalled, false);
    });

    it("does not scan factory providers for dependencies", async () => {
      const TOKEN = Symbol("fac");
      let mockerCalled = false;

      module = await Test.createTestingModule({
        providers: [{ provide: TOKEN, useFactory: () => 42 }],
      })
        .useMocker((_token) => {
          mockerCalled = true;
          return {};
        })
        .compile();

      assertEquals(mockerCalled, false);
    });

    it("auto-mocks dependencies for explicit class providers", async () => {
      const SERVICE = Symbol("service");
      const DEP = Symbol("dep");

      @Injectable()
      class ServiceWithDep {
        @Inject(DEP)
        dep!: { value: number };
      }

      module = await Test.createTestingModule({
        providers: [{ provide: SERVICE, useClass: ServiceWithDep }],
      })
        .useMocker((_token) => ({ value: 123 }))
        .compile();

      const svc = await module.get<ServiceWithDep>(SERVICE);

      assertEquals(svc.dep, { value: 123 });
    });

    it("explicit override wins over the auto-mocked value", async () => {
      const DEP = Symbol("dep");

      @Injectable()
      class ServiceWithDep {
        @Inject(DEP)
        dep!: string;
      }

      module = await Test.createTestingModule({
        providers: [ServiceWithDep],
      })
        .useMocker((_token) => "from-mocker")
        .overrideProvider(DEP)
        .useValue("from-override")
        .compile();

      const svc = await module.get(ServiceWithDep);

      assertEquals(svc.dep, "from-override");
    });
  });

  describe("useCoreGlobals()", () => {
    it("registers core globals for isolated module tests", async () => {
      @Injectable()
      class ServiceWithCoreGlobals {
        @Inject(ExceptionHandler)
        exceptionHandler!: ExceptionHandler;

        @Inject(InjectorContext)
        injectorContext!: InjectorContext;
      }

      module = await Test.createTestingModule({
        providers: [ServiceWithCoreGlobals],
      })
        .useCoreGlobals()
        .compile();

      const svc = await module.get(ServiceWithCoreGlobals);

      assertInstanceOf(svc.exceptionHandler, ExceptionHandler);
      assertInstanceOf(svc.injectorContext, InjectorContext);
    });

    it("keeps core globals opt-in", async () => {
      module = await Test.createTestingModule({}).compile();

      await assertRejects(() => module!.get(ExceptionHandler));
    });
  });

  describe("TestingModule lifecycle", () => {
    it("init() triggers onApplicationBootstrap on providers", async () => {
      let bootstrapped = false;

      @Injectable()
      class BootstrappableService implements OnApplicationBootstrap {
        onApplicationBootstrap(): void {
          bootstrapped = true;
        }
      }

      module = await Test.createTestingModule({
        providers: [BootstrappableService],
      }).compile();

      await module.init();

      assertEquals(bootstrapped, true);
    });

    it("close() triggers onApplicationShutdown on providers", async () => {
      let shutdown = false;

      @Injectable()
      class ShutdownService implements OnApplicationShutdown {
        onApplicationShutdown(): void {
          shutdown = true;
        }
      }

      module = await Test.createTestingModule({
        providers: [ShutdownService],
      }).compile();

      await module.close();
      module = undefined;

      assertEquals(shutdown, true);
    });

    it("onModuleInit is called during compile()", async () => {
      let initialized = false;

      @Injectable()
      class InitService implements OnModuleInit {
        onModuleInit(): void {
          initialized = true;
        }
      }

      module = await Test.createTestingModule({
        providers: [InitService],
      }).compile();

      assertEquals(initialized, true);
    });

    it("close() triggers onBeforeApplicationShutdown on providers", async () => {
      let beforeShutdown = false;

      @Injectable()
      class BeforeShutdownService implements OnBeforeApplicationShutdown {
        onBeforeApplicationShutdown(): void {
          beforeShutdown = true;
        }
      }

      module = await Test.createTestingModule({
        providers: [BeforeShutdownService],
      }).compile();

      await module.close();
      module = undefined;

      assertEquals(beforeShutdown, true);
    });
  });
});
