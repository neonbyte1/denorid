import {
  type InjectorContext,
  InjectorContext as InjectorContextImpl,
  type Type,
} from "@denorid/injector";
import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { Application } from "./application.ts";
import type {
  HttpApplicationContext,
  MicroserviceApplicationContext,
} from "./application_context.ts";
import { DenoridFactory } from "./denorid_factory.ts";
import { ExceptionHandler } from "./exceptions/handler.ts";
import type { ExecutionContext } from "./guards/execution_context.ts";
import type { ControllerMappingOptions, HttpAdapter } from "./http/adapter.ts";
import type { ControllerMapping } from "./http/controller_mapping.ts";
import { HttpApplication } from "./http_application.ts";
import { MicroserviceApplication } from "./microservice_application.ts";
import { MicroserviceServer } from "./microservices/server.ts";

describe("DenoridFactory", () => {
  class RootModule {}

  function makeInjectorContext(): InjectorContext {
    return {
      container: {
        getByTag: () => [],
        getTokensByTag: () => [],
      },
      resolve: () => Promise.resolve(undefined),
      resolveInternal: () => Promise.resolve(undefined),
      onApplicationBootstrap: () => Promise.resolve(),
      onBeforeApplicationShutdown: () => Promise.resolve(),
      onApplicationShutdown: () => Promise.resolve(),
    } as unknown as InjectorContext;
  }

  function makeControllerMapping(): ControllerMapping {
    return {
      register: () => Promise.resolve(),
    } as unknown as ControllerMapping;
  }

  function makeHttpAdapter(mapping?: ControllerMapping): HttpAdapter {
    return {
      listen: () => {},
      close: () => Promise.resolve(),
      createControllerMapping: (
        _opts: ControllerMappingOptions,
      ) => Promise.resolve(mapping ?? makeControllerMapping()),
    };
  }

  describe("create (plain application)", () => {
    it("returns an ApplicationContext instance", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const app = await DenoridFactory.create(RootModule as Type);

      assertInstanceOf(app, Application);
    });

    it("calls InjectorContext.create with the root module and useGlobals: true", async () => {
      const createStub = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      try {
        await DenoridFactory.create(RootModule as Type);

        const opts = createStub.calls[0].args[1] as {
          useGlobals: boolean;
          beforeInit: unknown;
        };

        assertSpyCalls(createStub, 1);
        assertEquals(createStub.calls[0].args[0], RootModule);
        assertEquals(opts.useGlobals, true);
        assertInstanceOf(opts.beforeInit, Function);
      } finally {
        createStub.restore();
      }
    });

    it("beforeInit registers ExceptionHandler globally with the context as argument", async () => {
      const createStub = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      try {
        await DenoridFactory.create(RootModule as Type);

        const opts = createStub.calls[0].args[1] as {
          beforeInit: (ctx: InjectorContext) => void;
        };

        const registered: { provide: unknown; useValue: unknown }[] = [];
        const mockCtx = {
          registerGlobal: (
            provider: { provide: unknown; useValue: unknown },
          ) => {
            registered.push(provider);
          },
        } as unknown as InjectorContext;

        opts.beforeInit(mockCtx);

        assertEquals(registered.length, 2);
        assertEquals(registered[0].provide, ExceptionHandler);
        assertInstanceOf(registered[0].useValue, ExceptionHandler);
      } finally {
        createStub.restore();
      }
    });

    it("does not expose a listen method (not an HttpApplicationContext)", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const app = await DenoridFactory.create(RootModule as Type);

      assertEquals("listen" in app, false);
    });
  });

  describe("create (HTTP application via adapter argument)", () => {
    it("returns an HttpApplication instance", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const app = await DenoridFactory.create(
        RootModule as Type,
        makeHttpAdapter(),
      );

      assertInstanceOf(app, HttpApplication);
    });

    it("exposes a listen method on the returned context", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const app = await DenoridFactory.create(
        RootModule as Type,
        makeHttpAdapter(),
      );

      assertEquals(typeof (app as HttpApplicationContext).listen, "function");
    });

    it("calls createControllerMapping on the adapter during init", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const adapter = makeHttpAdapter();
      const createMappingSpy = spy(adapter, "createControllerMapping");

      const app = await DenoridFactory.create(RootModule as Type, adapter);
      await app.init();

      assertSpyCalls(createMappingSpy, 1);
    });

    it("calls register on the controller mapping during init", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const mapping = makeControllerMapping();
      const registerSpy = spy(mapping, "register");

      const app = await DenoridFactory.create(
        RootModule as Type,
        makeHttpAdapter(mapping),
      );
      await app.init();

      assertSpyCalls(registerSpy, 1);
    });

    it("passes basePath to register when provided", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const mapping = makeControllerMapping();
      const registerSpy = spy(mapping, "register");

      const app = await DenoridFactory.create(
        RootModule as Type,
        makeHttpAdapter(mapping),
        {
          basePath: "/api",
        },
      );
      await app.init();

      assertSpyCalls(registerSpy, 1);
      assertEquals(registerSpy.calls[0].args[0], "/api");
    });

    it("ensure the same Guard won't be used twice", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const mapping = makeControllerMapping();
      const app = await DenoridFactory.create(
        RootModule as Type,
        makeHttpAdapter(mapping),
      );

      const testGuard = (_: ExecutionContext): boolean => false;

      app.useGlobalGuards(testGuard, testGuard, testGuard);

      assertEquals((app as HttpApplication)["globalGuards"].size, 1);
    });
  });

  describe("create (HTTP application via InternalHttpApplicationOptions)", () => {
    it("returns an HttpApplication when options contain an adapter", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const app = await DenoridFactory.create(RootModule as Type, {
        adapter: makeHttpAdapter(),
      });

      assertInstanceOf(app, HttpApplication);
    });

    it("calls createControllerMapping during init", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const adapter = makeHttpAdapter();
      const createMappingSpy = spy(adapter, "createControllerMapping");

      const app = await DenoridFactory.create(RootModule as Type, { adapter });
      await app.init();

      assertSpyCalls(createMappingSpy, 1);
    });

    it("respects basePath from internal options", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const mapping = makeControllerMapping();
      const registerSpy = spy(mapping, "register");

      const app = await DenoridFactory.create(RootModule as Type, {
        adapter: makeHttpAdapter(mapping),
        basePath: "/v1",
      });
      await app.init();

      assertSpyCalls(registerSpy, 1);
      assertEquals(registerSpy.calls[0].args[0], "/v1");
    });
  });

  describe("create (microservice application)", () => {
    class StubMicroserviceServer extends MicroserviceServer {
      public override listen(): Promise<void> {
        return Promise.resolve();
      }
      public override close(): Promise<void> {
        return Promise.resolve();
      }
      public override setExceptionHandler(): void {}
      public override registerHandlers(): void {}
      public override setGlobalGuards(): void {}
    }

    it("returns a MicroserviceApplication when passed a MicroserviceServer", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const app = await DenoridFactory.create(
        RootModule as Type,
        new StubMicroserviceServer({}),
      );

      assertInstanceOf(app, MicroserviceApplication);
    });

    it("exposes a listen() method on the returned context", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const app = await DenoridFactory.create(
        RootModule as Type,
        new StubMicroserviceServer({}),
      );

      assertEquals(
        typeof (app as MicroserviceApplicationContext).listen,
        "function",
      );
    });
  });
});
