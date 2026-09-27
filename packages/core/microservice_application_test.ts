import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import { describe, it } from "node:test";
import { ExceptionHandler } from "./exceptions/handler.ts";
import { MicroserviceApplication } from "./microservice_application.ts";
import {
  MessageController,
  MessagePattern,
} from "./microservices/decorators.ts";
import type { MicroserviceServer } from "./microservices/server.ts";

function makeInjectorContext(
  taggedTokens: Type[] = [],
): InjectorContext {
  return {
    container: {
      getTokensByTag: () => taggedTokens,
    },
    resolveInternal: (token: Type) => {
      if ((token as unknown) === ExceptionHandler) {
        const mockCtx = {
          container: { getTokensByTag: () => [] },
        } as unknown as InjectorContext;
        return Promise.resolve(new ExceptionHandler(mockCtx));
      }
      return Promise.resolve(new (token as new () => unknown)());
    },
    onApplicationBootstrap: () => Promise.resolve(),
    close: () => Promise.resolve(),
    getHostModuleRef: () => ({}),
  } as unknown as InjectorContext;
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

  const server: MicroserviceServer = {
    listen: async () => {
      calls["listen"].push(true);
      await Promise.resolve();
    },
    close: async () => {
      calls["close"].push(true);
      await Promise.resolve();
    },
    registerHandlers: (types: Type[], ctx: InjectorContext) => {
      calls["registerHandlers"].push([types, ctx]);
    },
    setExceptionHandler: (h: unknown) => {
      calls["setExceptionHandler"].push(h);
    },
    setGlobalGuards: (guards: unknown[]) => {
      calls["setGlobalGuards"].push(guards);
    },
  } as unknown as MicroserviceServer;

  return { server, calls };
}

class RootModule {}

describe("MicroserviceApplication", () => {
  describe("listen()", () => {
    it("calls init, register, setExceptionHandler, discoverHandlers, and server.listen", async () => {
      const ctx = makeInjectorContext();
      const bootstrapSpy = spy(ctx, "onApplicationBootstrap");
      const { server, calls } = makeMockServer();

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      using registerStub = stub(
        ExceptionHandler.prototype,
        "register",
        () => Promise.resolve(),
      );

      await app.listen();

      const exHandler =
        (app as unknown as Record<string, unknown>)["exceptionHandler"];

      assertEquals(bootstrapSpy.calls.length, 1);
      assertEquals(registerStub.calls.length, 1);
      assertEquals(calls["setExceptionHandler"].length, 1);
      assertStrictEquals(calls["setExceptionHandler"][0], exHandler);
      assertEquals(calls["setGlobalGuards"].length, 1);
      assertEquals(calls["listen"].length, 1);
    });

    it("is idempotent - second call is a no-op", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      await app.listen();
      await app.listen();

      assertEquals(calls["listen"].length, 1);
    });

    it("discovers and registers handlers from tagged controllers", async () => {
      @MessageController()
      class TestCtrl {
        @MessagePattern("test.ping")
        ping(): string {
          return "pong";
        }
      }

      const ctx = makeInjectorContext([TestCtrl as unknown as Type]);
      const { server, calls } = makeMockServer();

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      await app.listen();

      assertEquals(calls["registerHandlers"].length, 1);
      const [types] = calls["registerHandlers"][0] as [Type[], InjectorContext];
      assertEquals(types.includes(TestCtrl as unknown as Type), true);
    });

    it("passes empty arrays when no tagged controllers exist", async () => {
      const ctx = makeInjectorContext([]);
      const { server, calls } = makeMockServer();

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      await app.listen();

      const [types] = calls["registerHandlers"][0] as [Type[], InjectorContext];
      assertEquals(types.length, 0);
    });

    it("starts the server after an explicit init()", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();
      const app = new MicroserviceApplication(RootModule, ctx, {}, server);

      await app.init();
      await app.listen();

      assertEquals(calls["setExceptionHandler"].length, 1);
      assertEquals(calls["registerHandlers"].length, 1);
      assertEquals(calls["listen"].length, 1);
    });

    it("starts the server once for concurrent calls", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();
      const app = new MicroserviceApplication(RootModule, ctx, {}, server);
      using registerStub = stub(
        ExceptionHandler.prototype,
        "register",
        () => Promise.resolve(),
      );

      await Promise.all([app.listen(), app.listen()]);

      assertEquals(registerStub.calls.length, 1);
      assertEquals(calls["registerHandlers"].length, 1);
      assertEquals(calls["listen"].length, 1);
    });

    it("closes a server whose listen() rejected and starts over on the next call", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();
      const app = new MicroserviceApplication(RootModule, ctx, {}, server);
      let failures = 1;
      using _listen = stub(server, "listen", () => {
        calls["listen"].push(true);
        return failures-- > 0
          ? Promise.reject(new Error("EADDRINUSE"))
          : Promise.resolve();
      });

      await assertRejects(() => app.listen(), Error, "EADDRINUSE");
      assertEquals(calls["close"].length, 1);

      await app.listen();

      assertEquals(calls["listen"].length, 2);
      assertEquals(calls["close"].length, 1);
    });

    it("starts nothing once the application was closed", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();
      const app = new MicroserviceApplication(RootModule, ctx, {}, server);

      await app.close();
      await app.listen();

      assertEquals(calls["setExceptionHandler"].length, 0);
      assertEquals(calls["listen"].length, 0);
    });

    it("starts nothing when closed while initializing", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();
      const { promise: bootstrapped, resolve: bootstrap } = Promise
        .withResolvers<void>();
      using _bootstrap = stub(
        ctx,
        "onApplicationBootstrap",
        () => bootstrapped,
      );
      const app = new MicroserviceApplication(RootModule, ctx, {}, server);

      const listening = app.listen();
      const closed = app.close();
      bootstrap();
      await Promise.all([listening, closed]);

      assertEquals(calls["setExceptionHandler"].length, 0);
      assertEquals(calls["listen"].length, 0);
    });
  });

  describe("close()", () => {
    it("closes the server, then the injector context", async () => {
      const ctx = makeInjectorContext();
      const { server } = makeMockServer();
      const order: string[] = [];
      using _serverClose = stub(server, "close", () => {
        order.push("server");
        return Promise.resolve();
      });
      using _ctxClose = stub(ctx, "close", () => {
        order.push("ctx");
        return Promise.resolve();
      });

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      await app.listen();
      await app.close();

      assertEquals(order, ["server", "ctx"]);
    });

    it("closes the injector context when closing the server fails", async () => {
      const ctx = makeInjectorContext();
      const { server } = makeMockServer();
      const closeSpy = spy(ctx, "close");
      using _serverClose = stub(
        server,
        "close",
        () => Promise.reject(new Error("server close failed")),
      );

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      await app.listen();
      await assertRejects(() => app.close(), Error, "server close failed");

      assertEquals(closeSpy.calls.length, 1);
    });

    it("closes only the injector context when never listened", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();
      const closeSpy = spy(ctx, "close");

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      await app.close();

      assertEquals(calls["close"].length, 0);
      assertEquals(closeSpy.calls.length, 1);
    });
  });

  describe("useGlobalGuards()", () => {
    it("stores guards and forwards them to the server on listen", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      const guardFn = () => true;
      app.useGlobalGuards(guardFn);
      await app.listen();

      assertEquals(calls["setGlobalGuards"].length, 1);
      assertEquals(
        (calls["setGlobalGuards"][0] as unknown[])[0],
        guardFn,
      );
    });

    it("deduplicates the same guard instance", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      const guardFn = () => true;
      app.useGlobalGuards(guardFn, guardFn);
      await app.listen();

      assertEquals((calls["setGlobalGuards"][0] as unknown[]).length, 1);
    });
  });
});
