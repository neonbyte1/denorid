import { WsException, type WsMessageHandler } from "@denorid/core";
import type { WSEvents } from "@hono/hono/ws";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { describe, it } from "node:test";
import {
  createFakeSocket,
  createFakeUpgrade,
  getFreePort,
  TestWebSocket,
} from "./_test_utils.ts";
import { WebSocketHub } from "./_web_socket_hub.ts";
import { HonoAdapter } from "./adapter.ts";
import { WsAdapter, type WsGatewayOptions } from "./ws_adapter.ts";
import type { WsClient } from "./ws_client.ts";
import { WsServer } from "./ws_server.ts";

describe(WsAdapter.name, () => {
  function handler(
    event: string,
    callback: (data: unknown) => Promise<unknown>,
  ): WsMessageHandler {
    return { event, callback };
  }

  const echo = handler("echo", (data) => Promise.resolve(data));

  it("rejects adapters that are no HonoAdapter", () => {
    assertThrows(
      () => new WsAdapter({} as HonoAdapter),
      TypeError,
      "WsAdapter requires a HonoAdapter",
    );
  });

  describe("on a running server", () => {
    interface Served {
      hono: HonoAdapter;
      adapter: WsAdapter;
      server: WsServer;
      url: string;
      port: number;
    }

    /**
     * Serves a gateway on `/chat` through a real `Deno.serve` server, binding
     * `handlers` to every client.
     */
    async function serve(
      handlers: WsMessageHandler[],
      options: WsGatewayOptions = { path: "/chat" },
    ): Promise<Served> {
      const hono = new HonoAdapter();
      const adapter = new WsAdapter(hono);
      const server = await adapter.create(options);
      const port = getFreePort();

      adapter.bindClientConnect(
        server,
        (client) => adapter.bindMessageHandlers(client, handlers),
      );
      hono.listen(port);

      return {
        hono,
        adapter,
        server,
        port,
        url: `ws://127.0.0.1:${port}${server.path}`,
      };
    }

    async function stop({ hono, adapter, server }: Served): Promise<void> {
      await adapter.close(server);
      await hono.close();
    }

    it("delivers handler results", async () => {
      const served = await serve([
        echo,
        handler("news", (data) => Promise.resolve({ event: "news", data })),
        handler("silent", () => Promise.resolve(undefined)),
      ]);
      const client = await TestWebSocket.connect(served.url);

      try {
        client.send({ event: "echo", data: { text: "hi" }, id: 1 });
        assertEquals(await client.next(), '{"id":1,"data":{"text":"hi"}}');

        client.send({ event: "echo", data: "hi" });
        assertEquals(await client.next(), '"hi"');

        client.send({ event: "news", data: 2, id: 3 });
        assertEquals(await client.next(), '{"event":"news","data":2}');

        client.send({ event: "silent", id: 4 });
        client.send({ event: "echo", data: 5, id: 5 });
        assertEquals(await client.next(), '{"id":5,"data":5}');
      } finally {
        await stop(served);
        await client.closed;
      }
    });

    it("sends failures as exception events", async () => {
      const served = await serve([
        echo,
        handler("full", () => Promise.reject(new WsException("Room is full"))),
        handler("crash", () => Promise.reject(new Error("secret"))),
        handler("bigint", () => Promise.resolve(1n)),
      ]);
      const client = await TestWebSocket.connect(served.url);
      const internal = '{"status":"error","message":"Internal server error"}';

      try {
        client.send({ event: "full", id: 1 });
        assertEquals(
          await client.next(),
          '{"event":"exception","data":{"status":"error","message":"Room is full"},"id":1}',
        );

        client.send({ event: "full" });
        assertEquals(
          await client.next(),
          '{"event":"exception","data":{"status":"error","message":"Room is full"}}',
        );

        client.send({ event: "crash", id: 2 });
        assertEquals(
          await client.next(),
          `{"event":"exception","data":${internal},"id":2}`,
        );

        client.send({ event: "bigint", id: 3 });
        assertEquals(
          await client.next(),
          `{"event":"exception","data":${internal},"id":3}`,
        );

        client.send({ event: "missing", id: 4 });
        assertEquals(
          await client.next(),
          '{"event":"exception","data":{"status":"error","message":"Unknown event \\"missing\\""},"id":4}',
        );
      } finally {
        await stop(served);
        await client.closed;
      }
    });

    it("ignores unknown events without id, malformed messages and binary frames", async () => {
      const served = await serve([echo]);
      const client = await TestWebSocket.connect(served.url);

      try {
        client.send({ event: "missing" });
        client.sendRaw("{");
        client.send({ data: 1, id: 1 });
        client.sendRaw(new Uint8Array([1, 2, 3]));
        client.send({ event: "echo", data: "after", id: 2 });

        assertEquals(await client.next(), '{"id":2,"data":"after"}');
      } finally {
        await stop(served);
        await client.closed;
      }
    });

    it("passes the client and the upgrade request on connect", async () => {
      const hono = new HonoAdapter();
      const adapter = new WsAdapter(hono);
      const server = await adapter.create({ path: "/chat" });
      const port = getFreePort();
      const connected: [WsClient, unknown][] = [];

      adapter.bindClientConnect(server, (client, request) => {
        connected.push([client, request]);
        client.emit("welcome", client.id);
      });
      hono.listen(port);

      const client = await TestWebSocket.connect(
        `ws://127.0.0.1:${port}/chat?token=1`,
        { cookie: "session=1" },
      );

      try {
        const welcome = JSON.parse(await client.next());
        const [[wsClient, request]] = connected;

        assertEquals(welcome, { event: "welcome", data: wsClient.id });
        assertEquals([...server.clients], [wsClient]);
        assertStrictEquals(wsClient.request, request);
        assertEquals(
          wsClient.request.url,
          `http://127.0.0.1:${port}/chat?token=1`,
        );
        // Still readable after the upgrade.
        assertEquals(wsClient.request.headers.get("cookie"), "session=1");
      } finally {
        await adapter.close(server);
        await hono.close();
        await client.closed;
      }
    });

    it("broadcasts to all clients and to rooms", async () => {
      const hono = new HonoAdapter();
      const adapter = new WsAdapter(hono);
      const server = await adapter.create({ path: "/chat" });
      const port = getFreePort();
      const url = `ws://127.0.0.1:${port}/chat`;

      adapter.bindClientConnect(server, (client) => {
        adapter.bindMessageHandlers(client, [
          handler("join", (room) => {
            client.join(room as string);

            return Promise.resolve("joined");
          }),
          handler("shout", (text) => {
            server.to("lobby").emit("shout", text);
            server.emit("all", text);

            return Promise.resolve(undefined);
          }),
        ]);
      });
      hono.listen(port);

      const member = await TestWebSocket.connect(url);
      const other = await TestWebSocket.connect(url);

      try {
        member.send({ event: "join", data: "lobby", id: 1 });
        assertEquals(await member.next(), '{"id":1,"data":"joined"}');

        other.send({ event: "shout", data: "hi" });

        assertEquals(await member.next(), '{"event":"shout","data":"hi"}');
        assertEquals(await member.next(), '{"event":"all","data":"hi"}');
        assertEquals(await other.next(), '{"event":"all","data":"hi"}');
      } finally {
        await adapter.close(server);
        await hono.close();
        await member.closed;
        await other.closed;
      }
    });

    it("runs disconnect callbacks and leaves the rooms once a client disconnects", async () => {
      const hono = new HonoAdapter();
      const adapter = new WsAdapter(hono);
      const server = await adapter.create({ path: "/chat" });
      const port = getFreePort();
      const disconnected = Promise.withResolvers<string[]>();
      let wsClient: WsClient | undefined;

      adapter.bindClientConnect(server, (client) => {
        wsClient = client;
        client.join("lobby");
        adapter.bindClientDisconnect(
          client,
          () => disconnected.resolve([...client.rooms]),
        );
      });
      hono.listen(port);

      try {
        const client = await TestWebSocket.connect(
          `ws://127.0.0.1:${port}/chat`,
        );

        await client.close();

        assertEquals(await disconnected.promise, ["lobby"]);
        assertEquals(server.clients.size, 0);
        assertEquals(wsClient?.rooms.size, 0);
        assertEquals(wsClient?.readyState, 3);
      } finally {
        await adapter.close(server);
        await hono.close();
      }
    });

    it("shares one server per path and merges the handlers of its gateways", async () => {
      const hono = new HonoAdapter();
      const adapter = new WsAdapter(hono);
      const server = await adapter.create({ path: "/chat" });
      const port = getFreePort();

      assertStrictEquals(await adapter.create({ path: "chat" }), server);
      assertEquals((await adapter.create()).path, "/");

      adapter.bindClientConnect(
        server,
        (client) =>
          adapter.bindMessageHandlers(client, [
            handler("greet", () => Promise.resolve("first")),
            handler("leave", () => Promise.resolve("bye")),
          ]),
      );
      adapter.bindClientConnect(
        server,
        (client) =>
          adapter.bindMessageHandlers(client, [
            handler("greet", () => Promise.resolve("second")),
          ]),
      );
      hono.listen(port);

      const client = await TestWebSocket.connect(
        `ws://127.0.0.1:${port}/chat`,
      );

      try {
        client.send({ event: "greet", id: 1 });
        assertEquals(await client.next(), '{"id":1,"data":"second"}');

        client.send({ event: "leave", id: 2 });
        assertEquals(await client.next(), '{"id":2,"data":"bye"}');
      } finally {
        await adapter.close(server);
        await hono.close();
        await client.closed;
      }
    });

    it("closes every client but keeps the HTTP server running", async () => {
      const served = await serve([echo]);
      const first = await TestWebSocket.connect(served.url);
      const second = await TestWebSocket.connect(served.url);

      try {
        await served.adapter.close(served.server);

        assertEquals(served.server.clients.size, 0);
        assertEquals((await first.closed).code, 1001);
        assertEquals((await second.closed).code, 1001);

        await assertRejects(
          () => TestWebSocket.connect(served.url),
          Error,
          "Cannot connect",
        );

        const response = await fetch(`http://127.0.0.1:${served.port}/chat`);

        assertEquals(response.status, 404);
        await response.body?.cancel();
      } finally {
        await served.hono.close();
      }
    });

    it("rejects gateways created after the server listens", async () => {
      const served = await serve([]);

      try {
        await assertRejects(
          () => served.adapter.create({ path: "/late" }),
          Error,
          "WebSocket gateways must be created before the HonoAdapter listens",
        );
      } finally {
        await stop(served);
      }
    });
  });

  describe("create()", () => {
    it("rejects namespaces", async () => {
      const adapter = new WsAdapter(new HonoAdapter());

      await assertRejects(
        () => adapter.create({ namespace: "chat" }),
        Error,
        '"WsAdapter" does not support namespaces',
      );
    });

    it("rejects paths served by another adapter of the same HonoAdapter", async () => {
      const hono = new HonoAdapter();

      await new WsAdapter(hono).create({ path: "/chat" });

      await assertRejects(
        () => new WsAdapter(hono).create({ path: "/chat" }),
        Error,
        'WebSocket path "/chat" is already in use',
      );
    });
  });

  describe("with fake connections", () => {
    interface Fake {
      adapter: WsAdapter;
      server: WsServer;
      connect(): Promise<WSEvents>;
    }

    async function createFake(): Promise<Fake> {
      const owner = {};
      const hub = new WebSocketHub(owner, () => new Response("app"));
      const adapter = new WsAdapter(owner as HonoAdapter);
      const server = await adapter.create({ path: "/chat" });
      const upgrade = createFakeUpgrade();

      hub.listen(upgrade.upgradeWebSocket);

      return {
        adapter,
        server,
        connect: async (): Promise<WSEvents> => {
          await hub.fetch(
            new Request("http://localhost/chat", {
              headers: { upgrade: "websocket" },
            }),
            {},
          );

          return upgrade.connections.at(-1)!;
        },
      };
    }

    it("ignores messages and closes of connections that never opened", async () => {
      const { adapter, server, connect } = await createFake();
      const events = await connect();
      const listener = spy((_client: WsClient) => {});

      adapter.bindClientConnect(server, listener);
      events.onMessage!(
        new MessageEvent("message", { data: '{"event":"echo"}' }),
        createFakeSocket().context,
      );
      events.onClose!(new CloseEvent("close"), createFakeSocket().context);

      assertSpyCalls(listener, 0);
      assertEquals(server.clients.size, 0);
    });

    it("closes connections that open after their server closed", async () => {
      const { adapter, server, connect } = await createFake();
      const events = await connect();
      const socket = createFakeSocket();
      const listener = spy((_client: WsClient) => {});

      adapter.bindClientConnect(server, listener);
      await adapter.close(server);
      events.onOpen!(new Event("open"), socket.context);

      assertEquals(socket.closes, [[1001, "Server closing"]]);
      assertEquals(server.clients.size, 0);
      assertSpyCalls(listener, 0);
    });

    it("waits in close() until every client disconnected", async () => {
      const { adapter, server, connect } = await createFake();
      const events = await connect();
      const socket = createFakeSocket();
      let closed = false;

      events.onOpen!(new Event("open"), socket.context);

      const closing = adapter.close(server).then(() => {
        closed = true;
      });

      await Promise.resolve();

      assertEquals(socket.closes, [[1001, "Server closing"]]);
      assertEquals(closed, false);

      events.onClose!(new CloseEvent("close"), socket.context);
      await closing;

      assertEquals(closed, true);
    });

    it("runs disconnect callbacks bound after the disconnect right away", async () => {
      const { adapter, server, connect } = await createFake();
      const events = await connect();
      const socket = createFakeSocket();
      const clients: WsClient[] = [];

      adapter.bindClientConnect(server, (client) => clients.push(client));
      events.onOpen!(new Event("open"), socket.context);
      events.onClose!(new CloseEvent("close"), socket.context);

      const callback = spy(() => {});

      adapter.bindClientDisconnect(clients[0], callback);
      adapter.bindMessageHandlers(clients[0], [echo]);

      assertSpyCalls(callback, 1);
    });

    it("rejects binding servers it does not serve", async () => {
      const { adapter, server } = await createFake();
      const foreign = new WsServer("/chat", new Set());

      assertThrows(
        () => adapter.bindClientConnect(foreign, () => {}),
        Error,
        'WsServer on "/chat" is not served by this adapter',
      );

      await adapter.close(server);

      assertThrows(() => adapter.bindClientConnect(server, () => {}), Error);
    });

    it("resolves close() for servers it does not serve", async () => {
      const { adapter, server } = await createFake();

      await adapter.close(new WsServer("/chat", new Set()));
      await adapter.close(server);
      await adapter.close(server);
    });
  });
});
