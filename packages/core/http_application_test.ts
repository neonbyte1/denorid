import {
  type InjectorContext,
  InjectorContext as InjectorContextImpl,
  Module,
  type Type,
} from "@denorid/injector";
import { Logger } from "@denorid/logger";
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { describe, it } from "node:test";
import { Catch, type ExceptionFilter } from "./exceptions/filter.ts";
import { ExceptionHandler } from "./exceptions/handler.ts";
import { IntrinsicException } from "./exceptions/intrinsic.ts";
import type { HostArguments } from "./host_arguments.ts";
import type { ControllerMappingOptions, HttpAdapter } from "./http/adapter.ts";
import type { ControllerMapping } from "./http/controller_mapping.ts";
import type { CorsOptions } from "./http/cors.ts";
import { HttpApplication } from "./http_application.ts";
import type { MicroserviceServer } from "./microservices/server.ts";

class RootModule {}

function makeInjectorContext(): InjectorContext {
  const ctx = {
    container: {
      getByTag: () => [],
      getTokensByTag: () => [],
    },
    resolve: () => Promise.resolve(undefined),
    resolveInternal: () => Promise.resolve(new ExceptionHandler(ctx)),
    onApplicationBootstrap: () => Promise.resolve(),
    onBeforeApplicationShutdown: () => Promise.resolve(),
    onApplicationShutdown: () => Promise.resolve(),
  } as unknown as InjectorContext;

  return ctx;
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
  opts: {
    metaType?: Type;
    adapter?: HttpAdapter;
    ctx?: InjectorContext;
    cors?: boolean | CorsOptions;
  } = {},
): HttpApplication {
  return new HttpApplication(
    (opts.metaType ?? RootModule) as Type,
    opts.ctx ?? makeInjectorContext(),
    { adapter: opts.adapter ?? makeHttpAdapter(), cors: opts.cors },
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

    it("passes the cors option to the controller mapping", async () => {
      const cors: CorsOptions = { origin: "https://example.com" };
      const adapter = makeHttpAdapter();
      const createMappingSpy = spy(adapter, "createControllerMapping");

      await makeApp({ adapter, cors }).init();

      assertSpyCalls(createMappingSpy, 1);
      assertStrictEquals(createMappingSpy.calls[0].args[0].cors, cors);
    });

    it("registers exception filters before creating the controller mapping", async () => {
      const ctx = makeInjectorContext();
      const exceptionHandler = new ExceptionHandler(ctx);
      const order: string[] = [];
      const adapter = makeHttpAdapter();

      ctx.resolveInternal = <T>(): Promise<T> =>
        Promise.resolve(exceptionHandler as T);
      using _register = stub(exceptionHandler, "register", () => {
        order.push("register");
        return Promise.resolve();
      });
      using _mapping = stub(adapter, "createControllerMapping", () => {
        order.push("createControllerMapping");
        return Promise.resolve(makeControllerMapping());
      });

      await makeApp({ adapter, ctx }).init();

      assertEquals(order, ["register", "createControllerMapping"]);
    });

    it("runs @Catch() exception filters for errors of HTTP routes", async () => {
      class TeapotException extends IntrinsicException {}

      @Catch(TeapotException)
      class TeapotFilter implements ExceptionFilter<TeapotException> {
        public catch(): string {
          return "filtered";
        }
      }

      @Module({ providers: [TeapotFilter] })
      class AppModule {}

      using _log = stub(Logger.prototype, "log");
      const ctx = await InjectorContextImpl.create(AppModule, {
        beforeInit: (ctx: InjectorContext): void => {
          ctx.registerGlobal({
            provide: ExceptionHandler,
            useValue: new ExceptionHandler(ctx),
          });
        },
      });
      const results: unknown[] = [];
      const adapter: HttpAdapter = {
        ...makeHttpAdapter(),
        // Simulates a route handler that throws while the routes register.
        createControllerMapping: (
          { exceptionHandler }: ControllerMappingOptions,
        ) =>
          Promise.resolve({
            register: async (): Promise<void> => {
              const error = new TeapotException();

              results.push(
                exceptionHandler.canHandle(error),
                await exceptionHandler.handle(error, {} as HostArguments),
              );
            },
          } as unknown as ControllerMapping),
      };

      await new HttpApplication(AppModule, ctx, { adapter }).init();

      assertEquals(results, [true, "filtered"]);
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
