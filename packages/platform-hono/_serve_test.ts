import { Hono } from "@hono/hono";
import type { BunWebSocketData, BunWebSocketHandler } from "@hono/hono/bun";
import { upgradeWebSocket as upgradeDenoWebSocket } from "@hono/hono/deno";
import type { HttpBindings } from "@hono/node-server";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { describe, it } from "node:test";
import {
  type BunRuntime,
  createNodeServer,
  type FetchHandler,
  loadWebSocketModules,
  type ServerHandle,
  startServer,
  type WebSocketModules,
} from "./_serve.ts";
import { getFreePort, TestWebSocket } from "./_test_utils.ts";

async function get(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/`);

  return await response.text();
}

/**
 * Starts a server whose app echoes every text message received on `/ws`,
 * upgrading through the helper of the started server.
 */
function startEchoServer(start: (fetch: FetchHandler) => ServerHandle): {
  handle: ServerHandle;
  url: (port: number) => string;
} {
  const app = new Hono();
  const handle = start(app.fetch);

  app.get("/ws", (c, next) =>
    handle.upgradeWebSocket!(() => ({
      onMessage: (event, ws): void => ws.send(`echo:${event.data}`),
    }))(c, next));

  return { handle, url: (port) => `ws://127.0.0.1:${port}/ws` };
}

async function assertEcho(url: string): Promise<void> {
  const client = await TestWebSocket.connect(url);

  client.sendRaw("hi");

  assertEquals(await client.next(), "echo:hi");

  await client.close();
}

/** Socket Bun hands to the `websocket` handler. */
type BunSocket = Parameters<BunWebSocketHandler<BunWebSocketData>["open"]>[0];

interface FakeBunServer {
  requestIP(request: Request): { address: string } | null;
  upgrade(request: Request, options?: { data: BunWebSocketData }): boolean;
  stop(): Promise<void>;
}

/**
 * `Bun.serve` stand-in that listens for real (through `Deno.serve`), hands
 * the server object to the handler and upgrades WebSockets like Bun does:
 * `server.upgrade()` during the request, events through the `websocket`
 * handler.
 */
function createBun(): { bun: BunRuntime; servers: FakeBunServer[] } {
  const servers: FakeBunServer[] = [];
  const bun: BunRuntime = {
    serve: ({ port, fetch, websocket }) => {
      const upgrades = new WeakMap<Request, Response>();
      const denoServer = Deno.serve(
        { hostname: "127.0.0.1", port, onListen: () => {} },
        async (request) => {
          const response = await fetch(request, server);

          return upgrades.get(request) ?? response;
        },
      );
      const server: FakeBunServer = {
        requestIP: () => ({ address: "127.0.0.1" }),
        upgrade: (request, options) => {
          const { socket, response } = Deno.upgradeWebSocket(request);
          const ws: BunSocket = {
            data: options!.data,
            get readyState() {
              return socket.readyState as 0 | 1 | 2 | 3;
            },
            send: (data) => socket.send(data),
            close: (code, reason) => socket.close(code, reason),
          };

          socket.onopen = () => websocket!.open(ws);
          socket.onmessage = (event) => websocket!.message(ws, event.data);
          socket.onclose = (event) =>
            websocket!.close(ws, event.code, event.reason);
          upgrades.set(request, response);

          return true;
        },
        stop: () => denoServer.shutdown(),
      };

      servers.push(server);

      return server;
    },
  };

  return { bun, servers };
}

/**
 * Loads the modules for `bun`. `@hono/hono/bun` reads the `Bun` global while
 * being evaluated, so it is defined for the time of the import.
 */
async function loadBunModules(bun: BunRuntime): Promise<WebSocketModules> {
  const global = globalThis as { Bun?: unknown };

  global.Bun = {};

  try {
    return await loadWebSocketModules({ Bun: bun });
  } finally {
    delete global.Bun;
  }
}

describe(loadWebSocketModules.name, () => {
  it("loads @hono/hono/deno on Deno", async () => {
    assertEquals(await loadWebSocketModules(), { deno: upgradeDenoWebSocket });
  });

  it("loads @hono/hono/bun on Bun", async () => {
    const { bun } = createBun();
    const modules = await loadBunModules(bun);

    assertEquals(Object.keys(modules), ["bun"]);
    assertEquals(typeof modules.bun?.upgradeWebSocket, "function");
    assertEquals(typeof modules.bun?.websocket.message, "function");
  });

  it("loads nothing on Node.js", async () => {
    assertEquals(await loadWebSocketModules({ Deno: {}, Bun: {} }), {});
  });
});

describe(createNodeServer.name, () => {
  it("creates a node:http server that is not listening yet", async () => {
    const port = getFreePort();
    const server = createNodeServer(() => new Response("ok"));

    assertEquals(server.listening, false);

    server.listen(port);

    try {
      assertEquals(await get(port), "ok");
    } finally {
      const closed = Promise.withResolvers<void>();

      server.close(() => closed.resolve());
      await closed.promise;
    }
  });

  it("keeps the global Request and Response", async () => {
    const { Request, Response } = globalThis;
    const port = getFreePort();
    const server = createNodeServer(() => fetch("data:text/plain,upstream"));

    server.listen(port);

    try {
      assertEquals(await get(port), "upstream");
      assertStrictEquals(globalThis.Request, Request);
      assertStrictEquals(globalThis.Response, Response);
    } finally {
      const closed = Promise.withResolvers<void>();

      server.close(() => closed.resolve());
      await closed.promise;
    }
  });
});

describe(startServer.name, () => {
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
        assertEquals(server.upgradeWebSocket, undefined);
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

    it("upgrades WebSockets through @hono/hono/deno when enabled", async () => {
      const port = getFreePort();
      const webSockets = await loadWebSocketModules();
      const { handle, url } = startEchoServer((fetch) =>
        startServer(fetch, port, { webSockets })
      );

      try {
        assertStrictEquals(handle.upgradeWebSocket, webSockets.deno);
        await assertEcho(url(port));
      } finally {
        await handle.close();
      }
    });
  });

  describe("on Bun", () => {
    it("serves through Bun.serve, passing the server as bindings", async () => {
      const port = getFreePort();
      const { bun, servers } = createBun();
      const server = startServer(
        (_request, env) => new Response(String(env === servers[0])),
        port,
        {},
        { Bun: bun },
      );

      try {
        assertEquals(servers.length, 1);
        assertEquals(await get(port), "true");
        assertEquals(server.upgradeWebSocket, undefined);
      } finally {
        await server.close();
      }
    });

    it("stops accepting connections once closed", async () => {
      const port = getFreePort();
      const { bun } = createBun();
      const server = startServer(() => new Response("ok"), port, {}, {
        Bun: bun,
      });

      assertEquals(await get(port), "ok");

      await server.close();

      await assertRejects(() => get(port), TypeError);
    });

    it("is used when the Deno global lacks serve", async () => {
      const port = getFreePort();
      const { bun, servers } = createBun();
      const server = startServer(() => new Response("ok"), port, {}, {
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

    it("upgrades WebSockets through @hono/hono/bun when enabled", async () => {
      const port = getFreePort();
      const { bun } = createBun();
      const webSockets = await loadBunModules(bun);
      const { handle, url } = startEchoServer((fetch) =>
        startServer(fetch, port, { webSockets }, { Bun: bun })
      );

      try {
        assertStrictEquals(
          handle.upgradeWebSocket,
          webSockets.bun?.upgradeWebSocket,
        );
        await assertEcho(url(port));
      } finally {
        await handle.close();
      }
    });

    it("resolves close only after an asynchronous stop() settled", async () => {
      const stopped = Promise.withResolvers<void>();
      const server = startServer(() => new Response(), 0, {}, {
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
      const server = startServer(() => new Response(), 0, {}, {
        Bun: { serve: () => ({ stop }) },
      });

      await server.close();

      assertSpyCalls(stop, 1);
    });
  });

  describe("on Node.js", () => {
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
        {},
      );

      try {
        assertStringIncludes(await get(port), "127.0.0.1");
        assertEquals(server.upgradeWebSocket, undefined);
      } finally {
        await server.close();
      }
    });

    it("is used when neither Deno nor Bun provide serve", async () => {
      const port = getFreePort();
      const server = startServer(() => new Response("ok"), port, {}, {
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
        {},
      );

      assertEquals(await get(port), "ok");

      await server.close();

      await assertRejects(() => get(port), TypeError);
    });

    it("rejects close when the server is no longer running", async () => {
      const port = getFreePort();
      const server = startServer(() => new Response("ok"), port, {}, {});

      assertEquals(await get(port), "ok");
      await server.close();

      const error = await assertRejects(() => server.close(), Error);

      assertStrictEquals(
        (error as Error & { code?: string }).code,
        "ERR_SERVER_NOT_RUNNING",
      );
    });

    it("listens on a given node:http server on every runtime", async () => {
      const port = getFreePort();
      const nodeServer = createNodeServer(() => new Response("node"));
      const server = startServer(() => new Response("deno"), port, {
        nodeServer,
      });

      try {
        assertEquals(nodeServer.listening, true);
        assertEquals(await get(port), "node");
        assertEquals(nodeServer.listenerCount("upgrade"), 0);
      } finally {
        await server.close();
      }
    });

    it("upgrades WebSockets through ws when enabled", async () => {
      const port = getFreePort();
      const { handle, url } = startEchoServer((fetch) =>
        startServer(fetch, port, { webSockets: {} }, {})
      );

      try {
        await assertEcho(url(port));
      } finally {
        await handle.close();
      }
    });

    it("removes the upgrade handling on close, so the server can listen again", async () => {
      const port = getFreePort();
      let handle: ServerHandle | undefined;
      const app = new Hono();

      app.get("/ws", (c, next) =>
        handle!.upgradeWebSocket!(() => ({
          onMessage: (event, ws): void => ws.send(`echo:${event.data}`),
        }))(c, next));

      const nodeServer = createNodeServer(app.fetch);
      const url = `ws://127.0.0.1:${port}/ws`;

      for (let run = 0; run < 2; run++) {
        handle = startServer(app.fetch, port, {
          nodeServer,
          webSockets: {},
        });

        assertEquals(nodeServer.listenerCount("upgrade"), 1);
        await assertEcho(url);
        await handle.close();
        assertEquals(nodeServer.listenerCount("upgrade"), 0);
      }
    });
  });
});
