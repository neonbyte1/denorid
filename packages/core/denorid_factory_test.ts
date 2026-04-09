import {
  type InjectorContext,
  InjectorContext as InjectorContextImpl,
  type Type,
} from "@denorid/injector";
import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { Application } from "./application.ts";
import type { HttpApplicationContext } from "./application_context.ts";
import { DenoridFactory } from "./denorid_factory.ts";
import type { ExceptionHandler } from "./exceptions/handler.ts";
import type { HttpAdapter } from "./http/adapter.ts";
import type { ControllerMapping } from "./http/controller_mapping.ts";
import { HttpApplication } from "./http_application.ts";

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
        _ctx: InjectorContext,
        _handler: ExceptionHandler,
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

        assertSpyCalls(createStub, 1);
        assertEquals(createStub.calls[0].args[0], RootModule);
        assertEquals(createStub.calls[0].args[1], { useGlobals: true });
      } finally {
        createStub.restore();
      }
    });

    it("auto-initializes by default (calls onApplicationBootstrap)", async () => {
      const ctx = makeInjectorContext();
      const bootstrapSpy = spy(ctx, "onApplicationBootstrap");

      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(ctx),
      );

      await DenoridFactory.create(RootModule as Type);

      assertSpyCalls(bootstrapSpy, 1);
    });

    it("always auto-initializes regardless of autoInitialize in plain options", async () => {
      const ctx = makeInjectorContext();
      const bootstrapSpy = spy(ctx, "onApplicationBootstrap");

      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(ctx),
      );

      await DenoridFactory.create(RootModule as Type, {
        autoInitialize: false,
      });

      assertSpyCalls(bootstrapSpy, 1);
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

      await DenoridFactory.create(RootModule as Type, adapter);

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

      await DenoridFactory.create(RootModule as Type, makeHttpAdapter(mapping));

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

      await DenoridFactory.create(
        RootModule as Type,
        makeHttpAdapter(mapping),
        {
          basePath: "/api",
        },
      );

      assertSpyCalls(registerSpy, 1);
      assertEquals(registerSpy.calls[0].args[0], "/api");
    });

    it("skips init when autoInitialize is false", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const adapter = makeHttpAdapter();
      const createMappingSpy = spy(adapter, "createControllerMapping");

      await DenoridFactory.create(RootModule as Type, adapter, {
        autoInitialize: false,
      });

      assertSpyCalls(createMappingSpy, 0);
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

      await DenoridFactory.create(RootModule as Type, { adapter });

      assertSpyCalls(createMappingSpy, 1);
    });

    it("always auto-initializes regardless of autoInitialize in internal options", async () => {
      using _s = stub(
        InjectorContextImpl,
        "create",
        () => Promise.resolve(makeInjectorContext()),
      );

      const adapter = makeHttpAdapter();
      const createMappingSpy = spy(adapter, "createControllerMapping");

      await DenoridFactory.create(RootModule as Type, {
        adapter,
        autoInitialize: false,
      });

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

      await DenoridFactory.create(RootModule as Type, {
        adapter: makeHttpAdapter(mapping),
        basePath: "/v1",
      });

      assertSpyCalls(registerSpy, 1);
      assertEquals(registerSpy.calls[0].args[0], "/v1");
    });
  });
});
