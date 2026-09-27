import type {
  ExceptionHandler,
  RequestContext,
  WsMessageHandler,
} from "@denorid/core";
import { HttpMethod } from "@denorid/core";
import type { InjectorContext } from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { Server as NodeHttpServer } from "node:http";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getFreePort, TestWebSocket } from "./_test_utils.ts";
import { HonoAdapter, type HonoAdapterOptions } from "./adapter.ts";
import { WsAdapter } from "./ws_adapter.ts";

describe(HonoAdapter.name, () => {
  function getFreePorts(count: number): number[] {
    const listeners = Array.from(
      { length: count },
      () => Deno.listen({ hostname: "0.0.0.0", port: 0 }),
    );
    const ports = listeners.map((listener) => listener.addr.port);

    listeners.forEach((listener) => listener.close());

    return ports;
  }

  /**
   * Adapter with one controller mapped through `createControllerMapping`,
   * answering `GET /client/ip` with the resolved client IP and
   * `GET /client/upstream` with a `fetch()` response.
   */
  async function createAdapter(
    options?: HonoAdapterOptions,
    cors?: boolean,
  ): Promise<HonoAdapter> {
    class ClientController {}

    Object.defineProperty(ClientController, Symbol.metadata, {
      value: {
        [Symbol.for("denorid.controller")]: { path: "/client" },
        [Symbol.for("denorid.request_mapping")]: [
          { name: "ip", path: "ip", method: HttpMethod.GET },
          { name: "upstream", path: "upstream", method: HttpMethod.GET },
        ],
      },
    });

    const controller = {
      ip: (ctx: RequestContext): string => ctx.ip,
      upstream: (): Promise<Response> => fetch("data:text/plain,upstream"),
    };
    const adapter = new HonoAdapter(options);
    const mapping = await adapter.createControllerMapping({
      ctx: {
        container: { getTokensByTag: () => [ClientController] },
        runInRequestScopeAsync: (_id: string, fn: () => Promise<unknown>) =>
          fn(),
        clearContext: () => {},
        getHostModuleRef: () => ({ get: () => Promise.resolve(controller) }),
      } as unknown as InjectorContext,
      exceptionHandler: {} as ExceptionHandler,
      globalGuards: [],
      cors,
    });

    await mapping.register();

    return adapter;
  }

  async function getIp(port: number, headers?: HeadersInit): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${port}/client/ip`, {
      headers,
    });

    return await response.text();
  }

  function fakeServer(shutdown: () => Promise<void>): Deno.HttpServer {
    return { shutdown } as unknown as Deno.HttpServer;
  }

  const echo: WsMessageHandler = {
    event: "echo",
    callback: (data) => Promise.resolve(data),
  };

  /**
   * Serves an echo gateway on `path` through the WebSocket adapter created
   * by `adapter`, then listens on `port`.
   */
  async function listenWithGateway(
    adapter: HonoAdapter,
    path: string,
    port: number,
  ): Promise<() => Promise<void>> {
    const ws = adapter.createWebSocketAdapter();
    const server = await ws.create({ path });

    ws.bindClientConnect(
      server,
      (client) => ws.bindMessageHandlers(client, [echo]),
    );
    adapter.listen(port);

    return async (): Promise<void> => {
      await ws.close(server);
      await adapter.close();
    };
  }

  async function assertEcho(url: string, headers?: HeadersInit): Promise<void> {
    const client = await TestWebSocket.connect(url, headers);

    client.send({ event: "echo", data: "hi", id: 1 });

    assertEquals(await client.next(), '{"id":1,"data":"hi"}');

    await client.close();
  }

  describe("listen()", () => {
    it("serves the app on the given port", async () => {
      const [port] = getFreePorts(1);
      const adapter = await createAdapter();

      adapter.listen(port);

      try {
        assertEquals(await getIp(port), "127.0.0.1");
      } finally {
        await adapter.close();
      }
    });

    it("keeps the running server when called again", async () => {
      const [first, second] = getFreePorts(2);
      const adapter = await createAdapter();

      adapter.listen(first);
      adapter.listen(second);

      try {
        assertEquals(await getIp(first), "127.0.0.1");
        await assertRejects(() => getIp(second), TypeError);
      } finally {
        await adapter.close();
      }
    });

    it("defaults to port 3000", async () => {
      using serve = stub(
        Deno,
        "serve",
        (() => fakeServer(() => Promise.resolve())) as never,
      );
      const adapter = new HonoAdapter();

      adapter.listen();
      await adapter.close();

      assertSpyCalls(serve, 1);
      assertEquals<unknown>(serve.calls[0].args[0], { port: 3000 });
    });
  });

  describe("close()", () => {
    it("stops serving and lets a later listen() start again", async () => {
      const [port] = getFreePorts(1);
      const adapter = await createAdapter();

      adapter.listen(port);
      assertEquals(await getIp(port), "127.0.0.1");

      await adapter.close();
      await assertRejects(() => getIp(port), TypeError);

      adapter.listen(port);

      try {
        assertEquals(await getIp(port), "127.0.0.1");
      } finally {
        await adapter.close();
      }
    });

    it("resolves when the adapter never listened", async () => {
      await new HonoAdapter().close();
    });

    it("forgets the server even when shutting it down fails", async () => {
      using serve = stub(
        Deno,
        "serve",
        (() =>
          fakeServer(() =>
            Promise.reject(new Error("shutdown failed"))
          )) as never,
      );
      const adapter = new HonoAdapter();

      adapter.listen(8080);
      await assertRejects(() => adapter.close(), Error, "shutdown failed");

      adapter.listen(8080);

      assertSpyCalls(serve, 2);
      await assertRejects(() => adapter.close(), Error, "shutdown failed");
    });
  });

  describe("options", () => {
    it("resolves forwarded client addresses from trusted proxies", async () => {
      const [port] = getFreePorts(1);
      const adapter = await createAdapter({
        clientIp: { trustProxy: ["loopback"] },
      });

      adapter.listen(port);

      try {
        assertEquals(
          await getIp(port, { "x-forwarded-for": "6.6.6.6, 203.0.113.9" }),
          "203.0.113.9",
        );
      } finally {
        await adapter.close();
      }
    });

    it("serves static files next to controller routes", async () => {
      const [port] = getFreePorts(1);
      const root = await Deno.makeTempDir();

      await Deno.writeTextFile(join(root, "robots.txt"), "User-agent: *");

      const adapter = await createAdapter({ staticFiles: { root } });

      adapter.listen(port);

      try {
        const response = await fetch(`http://127.0.0.1:${port}/robots.txt`);

        assertEquals(await response.text(), "User-agent: *");
        assertEquals(await getIp(port), "127.0.0.1");
      } finally {
        await adapter.close();
        await Deno.remove(root, { recursive: true });
      }
    });
  });

  describe("WebSockets", () => {
    it("creates the native WsAdapter as default WebSocket adapter", () => {
      assertInstanceOf(new HonoAdapter().createWebSocketAdapter(), WsAdapter);
    });

    it("serves gateways through the native server of the runtime", async () => {
      const port = getFreePort();
      const stop = await listenWithGateway(new HonoAdapter(), "/chat", port);

      try {
        await assertEcho(`ws://127.0.0.1:${port}/chat`);
      } finally {
        await stop();
      }
    });

    it("keeps controller routes with CORS working on gateway paths", async () => {
      const port = getFreePort();
      const adapter = await createAdapter(undefined, true);
      const stop = await listenWithGateway(adapter, "/client/ip", port);
      const origin = { origin: "http://example.com" };

      try {
        const response = await fetch(`http://127.0.0.1:${port}/client/ip`, {
          headers: origin,
        });

        assertEquals(await response.text(), "127.0.0.1");
        assertEquals(response.headers.get("access-control-allow-origin"), "*");

        await assertEcho(`ws://127.0.0.1:${port}/client/ip`, origin);
      } finally {
        await stop();
      }
    });
  });

  describe("getHttpServer()", () => {
    it("returns the node:http server listen() and close() use", async () => {
      const port = getFreePort();
      const adapter = await createAdapter();
      const server = adapter.getHttpServer();

      assertInstanceOf(server, NodeHttpServer);
      assertStrictEquals(adapter.getHttpServer(), server);
      assertEquals(server.listening, false);

      adapter.listen(port);

      try {
        assertEquals(server.listening, true);
        assertEquals(await getIp(port), "127.0.0.1");
        assertStrictEquals(adapter.getHttpServer(), server);
        assertEquals(server.listenerCount("upgrade"), 0);
      } finally {
        await adapter.close();
      }

      assertEquals(server.listening, false);
    });

    it("passes Response objects of controllers through", async () => {
      const port = getFreePort();
      const adapter = await createAdapter();

      adapter.getHttpServer();
      adapter.listen(port);

      try {
        const response = await fetch(
          `http://127.0.0.1:${port}/client/upstream`,
        );

        assertEquals(await response.text(), "upstream");
      } finally {
        await adapter.close();
      }
    });

    it("throws once the adapter listens through the native server", async () => {
      using _serve = stub(
        Deno,
        "serve",
        (() => fakeServer(() => Promise.resolve())) as never,
      );
      const adapter = new HonoAdapter();

      adapter.listen(8080);

      try {
        assertThrows(
          () => adapter.getHttpServer(),
          Error,
          "HonoAdapter listens already; call getHttpServer() before listen()",
        );
      } finally {
        await adapter.close();
      }
    });

    it("serves gateways on the node:http server", async () => {
      const port = getFreePort();
      const adapter = new HonoAdapter();
      const server = adapter.getHttpServer();
      const stop = await listenWithGateway(adapter, "/chat", port);

      try {
        assertEquals(server.listenerCount("upgrade"), 1);
        await assertEcho(`ws://127.0.0.1:${port}/chat`);
      } finally {
        await stop();
      }
    });
  });
});
