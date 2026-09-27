import {
  type InjectorContext,
  InjectorContext as InjectorContextImpl,
  Module,
  type Type,
} from "@denorid/injector";
import { Logger } from "@denorid/logger";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Server as NodeHttpServer } from "node:http";
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
import { FakeWebSocketAdapter } from "./websockets/_test_utils.ts";
import { WebSocketGateway } from "./websockets/gateway.ts";

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
    close: () => Promise.resolve(),
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
    it("is idempotent - second call skips all work", async () => {
      const adapter = makeHttpAdapter();
      const createMappingSpy = spy(adapter, "createControllerMapping");
      const app = makeApp({ adapter });

      await app.init();
      await app.init();

      assertSpyCalls(createMappingSpy, 1);
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

    it("closes the gateways of a failed initialization before connecting them again", async () => {
      @WebSocketGateway({ path: "/chat" })
      class ChatGateway {}

      @Module({ providers: [ChatGateway] })
      class ChatModule {}

      using _log = stub(Logger.prototype, "log");
      const ctx = await InjectorContextImpl.create(ChatModule, {
        beforeInit: (ctx: InjectorContext): void => {
          ctx.registerGlobal({
            provide: ExceptionHandler,
            useValue: new ExceptionHandler(ctx),
          });
        },
      });
      let failures = 1;
      const adapter = makeHttpAdapter({
        register: (): Promise<void> =>
          failures-- > 0
            ? Promise.reject(new Error("routes failed"))
            : Promise.resolve(),
      } as unknown as ControllerMapping);
      const webSockets = new FakeWebSocketAdapter();
      const app = new HttpApplication(ChatModule, ctx, { adapter })
        .useWebSocketAdapter(webSockets);

      await assertRejects(() => app.init(), Error, "routes failed");
      assertEquals(webSockets.closed, []);

      await app.init();

      assertEquals(webSockets.closed, [webSockets.servers.get("/chat")]);
      await app.close();
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

    it("closes the injector context", async () => {
      const ctx = makeInjectorContext();
      const closeSpy = spy(ctx, "close");
      const app = makeApp({ ctx });

      await app.init();
      await app.close();

      assertSpyCalls(closeSpy, 1);
    });

    it("closes the injector context but not the adapter when never initialized", async () => {
      const ctx = makeInjectorContext();
      const adapter = makeHttpAdapter();
      const ctxCloseSpy = spy(ctx, "close");
      const adapterCloseSpy = spy(adapter, "close");

      await makeApp({ adapter, ctx }).close();

      assertSpyCalls(ctxCloseSpy, 1);
      assertSpyCalls(adapterCloseSpy, 0);
    });

    it("closes the injector context when closing the adapter fails", async () => {
      const ctx = makeInjectorContext();
      const adapter = makeHttpAdapter();
      const closeSpy = spy(ctx, "close");
      using _adapterClose = stub(
        adapter,
        "close",
        () => Promise.reject(new Error("adapter close failed")),
      );
      const app = makeApp({ adapter, ctx });

      await app.init();
      await assertRejects(() => app.close(), Error, "adapter close failed");

      assertSpyCalls(closeSpy, 1);
    });

    it("shuts down once for concurrent and repeated calls", async () => {
      const ctx = makeInjectorContext();
      const adapter = makeHttpAdapter();
      const ctxCloseSpy = spy(ctx, "close");
      const adapterCloseSpy = spy(adapter, "close");
      const app = makeApp({ adapter, ctx });

      await app.init();
      await Promise.all([app.close(), app[Symbol.asyncDispose]()]);
      await app.close();

      assertSpyCalls(ctxCloseSpy, 1);
      assertSpyCalls(adapterCloseSpy, 1);
    });

    it("does not start the server when closed while initializing", async () => {
      const adapter = makeHttpAdapter();
      const { promise: mapped, resolve: map } = Promise.withResolvers<
        ControllerMapping
      >();
      using listenSpy = spy(adapter, "listen");
      using _mapping = stub(adapter, "createControllerMapping", () => mapped);
      const app = makeApp({ adapter });

      app.listen();
      const closed = app.close();
      map(makeControllerMapping());
      await closed;
      await app.init();
      app.listen();

      assertSpyCalls(listenSpy, 0);
    });

    it("closes the HTTP adapter when init failed", async () => {
      const adapter = makeHttpAdapter();
      const app = makeApp({ adapter });
      using closeSpy = spy(adapter, "close");
      using _mapping = stub(
        adapter,
        "createControllerMapping",
        () => Promise.reject(new Error("mapping failed")),
      );

      await assertRejects(() => app.init(), Error, "mapping failed");
      await app.close();

      assertSpyCalls(closeSpy, 1);
    });
  });

  describe("useWebSocketAdapter", () => {
    it("returns this for method chaining", () => {
      const app = makeApp();

      assertStrictEquals(
        app.useWebSocketAdapter(new FakeWebSocketAdapter()),
        app,
      );
    });
  });

  describe("getHttpServer", () => {
    it("returns the node:http server of the HTTP adapter", () => {
      const server = {} as NodeHttpServer;
      const adapter: HttpAdapter = {
        ...makeHttpAdapter(),
        getHttpServer: (): NodeHttpServer => server,
      };

      assertStrictEquals(makeApp({ adapter }).getHttpServer(), server);
    });

    it("throws when the HTTP adapter has no node:http server", () => {
      assertThrows(
        () => makeApp().getHttpServer(),
        Error,
        "The HTTP adapter does not provide a node:http server",
      );
    });
  });

  describe("listen", () => {
    it("starts the server on the configured port once the routes are registered", async () => {
      const events: string[] = [];
      const adapter = makeHttpAdapter({
        register: (): Promise<void> => {
          events.push("routes");
          return Promise.resolve();
        },
      } as unknown as ControllerMapping);
      using _listen = stub(adapter, "listen", (port?: number): void => {
        events.push(`listen ${port}`);
      });
      const app = new HttpApplication(RootModule, makeInjectorContext(), {
        adapter,
        port: 8080,
      });

      const initialized = app.init();
      app.listen();
      assertEquals(events, []);

      await initialized;

      assertEquals(events, ["routes", "listen 8080"]);
    });

    it("starts the server once for repeated calls, also after init() was awaited", async () => {
      const adapter = makeHttpAdapter();
      using listenSpy = spy(adapter, "listen");
      const app = makeApp({ adapter });

      await app.init();
      app.listen();
      app.listen();
      await app.init();
      app.listen();
      await app.init();

      assertSpyCalls(listenSpy, 1);
    });

    it("does not start the server when init fails and starts over on the next call", async () => {
      const adapter = makeHttpAdapter();
      using listenSpy = spy(adapter, "listen");
      let failures = 1;
      using _mapping = stub(
        adapter,
        "createControllerMapping",
        () =>
          failures-- > 0
            ? Promise.reject(new Error("mapping failed"))
            : Promise.resolve(makeControllerMapping()),
      );
      const app = makeApp({ adapter });

      app.listen();
      await assertRejects(() => app["listening"]!, Error, "mapping failed");
      assertSpyCalls(listenSpy, 0);

      app.listen();
      await app.init();

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

    it("hands the exception handler to microservices only after the initialization completed", async () => {
      const events: string[] = [];
      const ctx = makeInjectorContext();
      const app = makeApp({ ctx });
      const { server, calls } = makeMockServer();
      using _bootstrap = stub(ctx, "onApplicationBootstrap", () => {
        events.push("bootstrap");
        return Promise.resolve();
      });
      using _handlers = stub(server, "registerHandlers", () => {
        events.push("registerHandlers");
      });
      app.connectMicroservice(server);

      app.listen();
      await app.startAllMicroservices();

      assertInstanceOf(calls.setExceptionHandler[0], ExceptionHandler);
      assertEquals(events, ["bootstrap", "registerHandlers"]);
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

    it("closes the failing server and the servers started before it", async () => {
      const app = makeApp();
      const { server: server1, calls: calls1 } = makeMockServer();
      const { server: failingServer, calls: failingCalls } = makeMockServer();
      failingServer.listen = (): Promise<void> =>
        Promise.reject(new Error("Connection refused"));

      app.connectMicroservice(server1).connectMicroservice(failingServer);

      await assertRejects(
        () => app.startAllMicroservices(),
        Error,
        "Connection refused",
      );
      assertEquals(calls1.close.length, 1);
      assertEquals(failingCalls.close.length, 1);
    });

    it("waits until a server is ready before starting the next one", async () => {
      const app = makeApp();
      const { server: tcp, calls: tcpCalls } = makeMockServer();
      const { server: rmq, calls: rmqCalls } = makeMockServer();
      const tcpReady = Promise.withResolvers<void>();

      tcp.listen = (): Promise<void> => {
        tcpCalls.listen.push(true);
        return tcpReady.promise;
      };
      app.connectMicroservice(tcp).connectMicroservice(rmq);

      const started = app.startAllMicroservices();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      assertEquals([tcpCalls.listen.length, rmqCalls.listen.length], [1, 0]);

      tcpReady.resolve();
      await started;

      assertEquals(rmqCalls.listen.length, 1);
    });

    it("starts no further server when the application closes while one starts", async () => {
      const app = makeApp();
      const { server: tcp, calls: tcpCalls } = makeMockServer();
      const { server: rmq, calls: rmqCalls } = makeMockServer();
      const tcpReady = Promise.withResolvers<void>();

      tcp.listen = (): Promise<void> => tcpReady.promise;
      app.connectMicroservice(tcp).connectMicroservice(rmq);

      const started = app.startAllMicroservices();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await app.close();
      tcpReady.resolve();
      await started;

      assertEquals(tcpCalls.close.length, 1);
      assertEquals(rmqCalls.listen.length, 0);
    });

    it("starts no microservice once the application was closed", async () => {
      const app = makeApp();
      const { server, calls } = makeMockServer();
      app.connectMicroservice(server);

      await app.close();
      await app.startAllMicroservices();

      assertEquals(calls.listen.length, 0);
    });

    it("starts no microservice when closed while initializing", async () => {
      const adapter = makeHttpAdapter();
      const { promise: mapped, resolve: map } = Promise.withResolvers<
        ControllerMapping
      >();
      using _mapping = stub(adapter, "createControllerMapping", () => mapped);
      const app = makeApp({ adapter });
      const { server, calls } = makeMockServer();
      app.connectMicroservice(server);

      const started = app.startAllMicroservices();
      const closed = app.close();
      map(makeControllerMapping());
      await Promise.all([started, closed]);

      assertEquals(calls.setExceptionHandler.length, 0);
      assertEquals(calls.listen.length, 0);
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
