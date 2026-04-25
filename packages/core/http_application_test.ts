import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { ExceptionHandler } from "./exceptions/handler.ts";
import type { HttpAdapter } from "./http/adapter.ts";
import type { ControllerMapping } from "./http/controller_mapping.ts";
import { HttpApplication } from "./http_application.ts";

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

function makeApp(
  opts: { metaType?: Type; adapter?: HttpAdapter } = {},
): HttpApplication {
  return new HttpApplication(
    (opts.metaType ?? RootModule) as Type,
    makeInjectorContext(),
    { adapter: opts.adapter ?? makeHttpAdapter() },
  );
}

describe("HttpApplication", () => {
  describe("init", () => {
    it("sets initialized to true on first call", async () => {
      const app = makeApp();

      await app.init();

      assertEquals(app["initialized"], true);
    });

    it("is idempotent - second call skips all work", async () => {
      const adapter = makeHttpAdapter();
      const createMappingSpy = spy(adapter, "createControllerMapping");
      const app = makeApp({ adapter });

      await app.init();
      await app.init();

      assertSpyCalls(createMappingSpy, 1);
    });

    it("skips metadata push when metaType has no @Module decorator", async () => {
      const app = makeApp();
      await app.init();

      assertEquals(app["initialized"], true);
    });
  });

  describe("close", () => {
    it("calls adapter.close when initialized", async () => {
      const adapter = makeHttpAdapter();
      const closeSpy = spy(adapter, "close");
      const app = makeApp({ adapter });

      await app.init();
      await app.close();

      assertSpyCalls(closeSpy, 1);
    });

    it("calls ctx shutdown hooks when initialized", async () => {
      const ctx = makeInjectorContext();
      const shutdownSpy = spy(ctx, "onApplicationShutdown");
      const app = new HttpApplication(
        RootModule as Type,
        ctx,
        { adapter: makeHttpAdapter() },
      );

      await app.init();
      await app.close();

      assertSpyCalls(shutdownSpy, 1);
    });

    it("is a no-op when not initialized", async () => {
      const adapter = makeHttpAdapter();
      const closeSpy = spy(adapter, "close");
      const app = makeApp({ adapter });

      await app.close();

      assertSpyCalls(closeSpy, 0);
    });
  });

  describe("listen", () => {
    it("sets listening to pending then active and calls adapter.listen after init", async () => {
      const adapter = makeHttpAdapter();
      const listenSpy = spy(adapter, "listen");
      const app = makeApp({ adapter });

      using _s = stub(app, "init", () => Promise.resolve());

      app.listen();
      assertEquals(app["listening"], "pending");

      await new Promise<void>((r) => setTimeout(r, 0));

      assertEquals(app["listening"], "active");
      assertSpyCalls(listenSpy, 1);
    });

    it("does not call adapter.listen when already active before init resolves", async () => {
      const adapter = makeHttpAdapter();
      const listenSpy = spy(adapter, "listen");
      const app = makeApp({ adapter });

      app["listening"] = "active";

      using _s = stub(app, "init", () => Promise.resolve());

      app.listen();

      await new Promise<void>((r) => setTimeout(r, 0));

      assertSpyCalls(listenSpy, 0);
    });

    it("calls adapter.listen directly when initialized and not yet listening", async () => {
      const adapter = makeHttpAdapter();
      const listenSpy = spy(adapter, "listen");
      const app = makeApp({ adapter });

      await app.init();
      app.listen();

      assertEquals(app["listening"], "active");
      assertSpyCalls(listenSpy, 1);
    });

    it("is a no-op when initialized and already listening", async () => {
      const adapter = makeHttpAdapter();
      const listenSpy = spy(adapter, "listen");
      const app = makeApp({ adapter });

      await app.init();
      app.listen();
      app.listen();

      assertSpyCalls(listenSpy, 1);
    });
  });
});
