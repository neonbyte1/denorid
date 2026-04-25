import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { spy } from "@std/testing/mock";
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
    resolveInternal: (token: Type) =>
      Promise.resolve(new (token as new () => unknown)()),
    onApplicationBootstrap: () => Promise.resolve(),
    onBeforeApplicationShutdown: () => Promise.resolve(),
    onApplicationShutdown: () => Promise.resolve(),
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

      const exHandler =
        (app as unknown as Record<string, { register(): Promise<void> }>)[
          "exceptionHandler"
        ];
      const registerSpy = spy(exHandler, "register");

      await app.listen();

      assertEquals(bootstrapSpy.calls.length, 1);
      assertEquals(registerSpy.calls.length, 1);
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
  });

  describe("close()", () => {
    it("calls server.close then super.close when initialized", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();
      const shutdownSpy = spy(ctx, "onApplicationShutdown");

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      await app.listen();
      await app.close();

      assertEquals(calls["close"].length, 1);
      assertEquals(shutdownSpy.calls.length, 1);
    });

    it("is a no-op when not initialized", async () => {
      const ctx = makeInjectorContext();
      const { server, calls } = makeMockServer();
      const shutdownSpy = spy(ctx, "onApplicationShutdown");

      const app = new MicroserviceApplication(
        RootModule as Type,
        ctx,
        {},
        server,
      );

      await app.close();

      assertEquals(calls["close"].length, 0);
      assertEquals(shutdownSpy.calls.length, 0);
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
