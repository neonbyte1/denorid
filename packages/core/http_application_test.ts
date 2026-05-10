import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { ControllerMappingOptions, HttpAdapter } from "./http/adapter.ts";
import type { ControllerMapping } from "./http/controller_mapping.ts";
import { HttpApplication } from "./http_application.ts";
import type { MicroserviceServer } from "./microservices/server.ts";

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

function makeApp(
  opts: { metaType?: Type; adapter?: HttpAdapter; ctx?: InjectorContext } = {},
): HttpApplication {
  return new HttpApplication(
    (opts.metaType ?? RootModule) as Type,
    opts.ctx ?? makeInjectorContext(),
    { adapter: opts.adapter ?? makeHttpAdapter() },
  );
}

function makeMockServer(): {
  server: MicroserviceServer;
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {
    listen: [],
    close: [],
    registerHandlers: [],
    setExceptionHandler: [],
    setGlobalGuards: [],
  };
  return {
    server: {
      listen: () => {
        calls.listen.push(true);
        return Promise.resolve();
      },
      close: () => {
        calls.close.push(true);
        return Promise.resolve();
      },
      registerHandlers: (...args: unknown[]) => {
        calls.registerHandlers.push(args);
      },
      setExceptionHandler: (h: unknown) => {
        calls.setExceptionHandler.push(h);
      },
      setGlobalGuards: (g: unknown[]) => {
        calls.setGlobalGuards.push(g);
      },
    } as unknown as MicroserviceServer,
    calls,
  };
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

  describe("connectMicroservice", () => {
    it("returns this for method chaining", () => {
      const app = makeApp();
      const { server } = makeMockServer();

      const result = app.connectMicroservice(server);

      assertStrictEquals(result, app);
    });

    it("allows connecting multiple servers", () => {
      const app = makeApp();
      const { server: server1 } = makeMockServer();
      const { server: server2 } = makeMockServer();

      app.connectMicroservice(server1).connectMicroservice(server2);

      assertEquals(app["microservices"].size, 2);
    });

    it("deduplicates same server instance", () => {
      const app = makeApp();
      const { server } = makeMockServer();

      app.connectMicroservice(server);
      app.connectMicroservice(server);

      assertEquals(app["microservices"].size, 1);
    });
  });

  describe("startAllMicroservices", () => {
    it("resolves immediately when no microservices connected", async () => {
      const app = makeApp();
      const initSpy = spy(app, "init");

      await app.startAllMicroservices();

      assertSpyCalls(initSpy, 0);
    });

    it("initializes the app before starting microservices", async () => {
      const app = makeApp();
      const { server } = makeMockServer();
      app.connectMicroservice(server);

      await app.startAllMicroservices();

      assertEquals(app["initialized"], true);
    });

    it("calls server lifecycle methods in order", async () => {
      const app = makeApp();
      const { server, calls } = makeMockServer();
      app.connectMicroservice(server);

      await app.startAllMicroservices();

      assertEquals(calls.setExceptionHandler.length, 1);
      assertEquals(calls.setGlobalGuards.length, 1);
      assertEquals(calls.registerHandlers.length, 1);
      assertEquals(calls.listen.length, 1);
    });

    it("starts all connected microservices", async () => {
      const app = makeApp();
      const { server: server1, calls: calls1 } = makeMockServer();
      const { server: server2, calls: calls2 } = makeMockServer();

      app.connectMicroservice(server1).connectMicroservice(server2);
      await app.startAllMicroservices();

      assertEquals(calls1.listen.length, 1);
      assertEquals(calls2.listen.length, 1);
    });

    it("passes empty guards by default", async () => {
      const app = makeApp();
      const guardFn = () => true;
      app.useGlobalGuards(guardFn);

      const { server, calls } = makeMockServer();
      app.connectMicroservice(server);
      await app.startAllMicroservices();

      assertEquals(calls.setGlobalGuards[0], []);
    });

    it("passes HTTP guards with inheritAppConfig", async () => {
      const app = makeApp();
      const guardFn = () => true;
      app.useGlobalGuards(guardFn);

      const { server, calls } = makeMockServer();
      app.connectMicroservice(server, { inheritAppConfig: true });
      await app.startAllMicroservices();

      const guards = calls.setGlobalGuards[0] as unknown[];
      assertEquals(guards.length, 1);
      assertStrictEquals(guards[0], guardFn);
    });

    it("rolls back started servers on failure", async () => {
      const app = makeApp();
      const { server: server1, calls: calls1 } = makeMockServer();
      const { server: failingServer } = makeMockServer();
      (failingServer as { listen: () => Promise<void> }).listen = () =>
        Promise.reject(new Error("Connection refused"));

      app.connectMicroservice(server1).connectMicroservice(failingServer);

      await assertRejects(
        () => app.startAllMicroservices(),
        Error,
        "Connection refused",
      );
      assertEquals(calls1.close.length, 1);
    });
  });

  describe("close with microservices", () => {
    it("closes all connected microservices", async () => {
      const app = makeApp();
      const { server: server1, calls: calls1 } = makeMockServer();
      const { server: server2, calls: calls2 } = makeMockServer();

      app.connectMicroservice(server1).connectMicroservice(server2);
      await app.init();
      await app.close();

      assertEquals(calls1.close.length, 1);
      assertEquals(calls2.close.length, 1);
    });

    it("continues closing other microservices if one fails", async () => {
      const app = makeApp();
      const { server: failingServer } = makeMockServer();
      (failingServer as { close: () => Promise<void> }).close = () =>
        Promise.reject(new Error("Close failed"));
      const { server: server2, calls: calls2 } = makeMockServer();

      app.connectMicroservice(failingServer).connectMicroservice(server2);
      await app.init();
      await app.close();

      assertEquals(calls2.close.length, 1);
    });
  });
});
