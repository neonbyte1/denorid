import type { HttpBindings } from "@hono/node-server";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { afterEach, beforeEach, describe, it } from "node:test";
import { type BunRuntime, type ServerHandle, startServer } from "./_serve.ts";

describe(startServer.name, () => {
  function getFreePort(): number {
    const listener = Deno.listen({ hostname: "0.0.0.0", port: 0 });
    const { port } = listener.addr;

    listener.close();

    return port;
  }

  async function get(port: number): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${port}/`);

    return await response.text();
  }

  describe("on Deno", () => {
    it("serves through Deno.serve, passing the handler info as bindings", async () => {
      const port = getFreePort();
      const server = startServer(
        (_request, env) => {
          // Deno.serve hands its handler info to the app as bindings.
          const info = env as Deno.ServeHandlerInfo<Deno.NetAddr>;

          return new Response(info.remoteAddr.hostname);
        },
        port,
      );

      try {
        assertEquals(await get(port), "127.0.0.1");
      } finally {
        await server.close();
      }
    });

    it("stops accepting connections once closed", async () => {
      const port = getFreePort();
      const server = startServer(() => new Response("ok"), port);

      assertEquals(await get(port), "ok");

      await server.close();

      await assertRejects(() => get(port), TypeError);
    });
  });

  describe("on Bun", () => {
    interface FakeBunServer {
      requestIP(request: Request): { address: string } | null;
      stop(): Promise<void>;
    }

    /**
     * `Bun.serve` stand-in that listens for real (through `Deno.serve`) and
     * hands the server object to the handler, like Bun does.
     */
    function createBun(): { bun: BunRuntime; servers: FakeBunServer[] } {
      const servers: FakeBunServer[] = [];
      const bun: BunRuntime = {
        serve: ({ port, fetch }) => {
          const denoServer = Deno.serve(
            { hostname: "127.0.0.1", port, onListen: () => {} },
            (request) => fetch(request, server),
          );
          const server: FakeBunServer = {
            requestIP: () => ({ address: "127.0.0.1" }),
            stop: () => denoServer.shutdown(),
          };

          servers.push(server);

          return server;
        },
      };

      return { bun, servers };
    }

    it("serves through Bun.serve, passing the server as bindings", async () => {
      const port = getFreePort();
      const { bun, servers } = createBun();
      const server = startServer(
        (_request, env) => new Response(String(env === servers[0])),
        port,
        { Bun: bun },
      );

      try {
        assertEquals(servers.length, 1);
        assertEquals(await get(port), "true");
      } finally {
        await server.close();
      }
    });

    it("stops accepting connections once closed", async () => {
      const port = getFreePort();
      const { bun } = createBun();
      const server = startServer(() => new Response("ok"), port, { Bun: bun });

      assertEquals(await get(port), "ok");

      await server.close();

      await assertRejects(() => get(port), TypeError);
    });

    it("is used when the Deno global lacks serve", async () => {
      const port = getFreePort();
      const { bun, servers } = createBun();
      const server = startServer(() => new Response("ok"), port, {
        Deno: {},
        Bun: bun,
      });

      try {
        assertEquals(servers.length, 1);
        assertEquals(await get(port), "ok");
      } finally {
        await server.close();
      }
    });

    it("resolves close only after an asynchronous stop() settled", async () => {
      const stopped = Promise.withResolvers<void>();
      const server = startServer(() => new Response(), 0, {
        Bun: { serve: () => ({ stop: () => stopped.promise }) },
      });
      let closed = false;
      const closing = server.close().then(() => {
        closed = true;
      });

      const tick = Promise.withResolvers<void>();
      setTimeout(tick.resolve, 0);
      await tick.promise;

      assertEquals(closed, false);

      stopped.resolve();
      await closing;

      assertEquals(closed, true);
    });

    it("supports a synchronous stop() from older Bun versions", async () => {
      const stop = spy((): void => {});
      const server = startServer(() => new Response(), 0, {
        Bun: { serve: () => ({ stop }) },
      });

      await server.close();

      assertSpyCalls(stop, 1);
    });
  });

  describe("on Node.js", () => {
    // @hono/node-server swaps the global Request/Response for its own
    // lightweight classes, which Deno.serve would reject in later tests.
    function registerGlobalRestore(): void {
      let request: PropertyDescriptor | undefined;
      let response: PropertyDescriptor | undefined;

      beforeEach(() => {
        request = Object.getOwnPropertyDescriptor(globalThis, "Request");
        response = Object.getOwnPropertyDescriptor(globalThis, "Response");
      });

      afterEach(() => {
        Object.defineProperty(globalThis, "Request", request!);
        Object.defineProperty(globalThis, "Response", response!);
      });
    }

    registerGlobalRestore();

    it("serves through @hono/node-server, passing the node:http bindings", async () => {
      const port = getFreePort();
      const server = startServer(
        (_request, env) => {
          // @hono/node-server hands the node:http pair to the app as bindings.
          const bindings = env as HttpBindings;

          return new Response(bindings.incoming.socket.remoteAddress);
        },
        port,
        {},
      );

      try {
        assertStringIncludes(await get(port), "127.0.0.1");
      } finally {
        await server.close();
      }
    });

    it("is used when neither Deno nor Bun provide serve", async () => {
      const port = getFreePort();
      const server = startServer(() => new Response("ok"), port, {
        Deno: {},
        Bun: {},
      });

      try {
        assertEquals(await get(port), "ok");
      } finally {
        await server.close();
      }
    });

    it("stops accepting connections once closed", async () => {
      const port = getFreePort();
      const server: ServerHandle = startServer(
        () => new Response("ok"),
        port,
        {},
      );

      assertEquals(await get(port), "ok");

      await server.close();

      await assertRejects(() => get(port), TypeError);
    });

    it("rejects close when the server is no longer running", async () => {
      const port = getFreePort();
      const server = startServer(() => new Response("ok"), port, {});

      assertEquals(await get(port), "ok");
      await server.close();

      const error = await assertRejects(() => server.close(), Error);

      assertStrictEquals(
        (error as Error & { code?: string }).code,
        "ERR_SERVER_NOT_RUNNING",
      );
    });
  });
});
