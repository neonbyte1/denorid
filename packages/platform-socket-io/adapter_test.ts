import { WsException, type WsMessageHandler } from "@denorid/core/websockets";
import {
  assertEquals,
  assertInstanceOf,
  assertNotStrictEquals,
  assertStrictEquals,
} from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import {
  createServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Namespace, Server, type ServerOptions, type Socket } from "socket.io";
import {
  io as connectClient,
  type ManagerOptions,
  type Socket as ClientSocket,
  type SocketOptions,
} from "socket.io-client";
import { SocketIoAdapter } from "./adapter.ts";

/** Room adapter of a namespace (socket.io-adapter `Adapter`). */
type RoomAdapter = Namespace["adapter"];

/** Room adapter class (socket.io-adapter `typeof Adapter`). */
type AdapterClass = Extract<
  ServerOptions["adapter"],
  new (nsp: Namespace) => RoomAdapter
>;

/** Options a room adapter receives in `disconnectSockets`. */
type DisconnectOptions = Parameters<RoomAdapter["disconnectSockets"]>[0];

describe(SocketIoAdapter.name, () => {
  let http: NodeHttpServer;
  let port: number;
  let adapter: SocketIoAdapter;
  let clients: ClientSocket[];

  /** Real `node:http` server on a free port plus an adapter attached to it. */
  function useHarness(): void {
    beforeEach(async () => {
      http = createServer((_req: IncomingMessage, res: ServerResponse) => {
        res.end("ok");
      });
      const listening = Promise.withResolvers<void>();

      http.listen(0, "127.0.0.1", listening.resolve);
      await listening.promise;

      // Listening on TCP: `address()` is an `AddressInfo`.
      const address = http.address() as AddressInfo;

      port = address.port;
      adapter = new SocketIoAdapter({ getHttpServer: () => http });
      clients = [];
    });

    afterEach(async () => {
      for (const client of clients) {
        client.disconnect();
      }

      const closed = Promise.withResolvers<void>();

      http.closeAllConnections();
      http.close(() => closed.resolve());
      await closed.promise;
    });
  }

  /** Connects a socket.io client to `namespace` and waits for `connect`. */
  function connect(
    namespace: string = "/",
    options: Partial<ManagerOptions & SocketOptions> = {},
  ): Promise<ClientSocket> {
    const client = connectClient(`http://127.0.0.1:${port}${namespace}`, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
      ...options,
    });

    clients.push(client);

    const { promise, resolve, reject } = Promise.withResolvers<ClientSocket>();

    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);

    return promise;
  }

  /** Handler whose callback resolves with `fn(data)`. */
  function handler(
    event: string,
    fn: (data: unknown) => unknown,
  ): WsMessageHandler {
    return { event, callback: async (data: unknown) => await fn(data) };
  }

  /**
   * Creates the gateway server for `namespace`, binds `handlers` (plus a
   * `ping` handler answering `pong`) to every client and connects one client.
   */
  async function connectGateway(
    handlers: WsMessageHandler[],
    namespace: string = "/",
  ): Promise<ClientSocket> {
    const server = adapter.create({ namespace });

    adapter.bindClientConnect(server, (socket: Socket) => {
      adapter.bindMessageHandlers(socket, [
        ...handlers,
        handler("ping", () => "pong"),
      ]);
    });

    return await connect(namespace);
  }

  /**
   * Round trip over the connection: the server processed and answered every
   * event emitted before it.
   */
  async function flush(client: ClientSocket): Promise<void> {
    assertEquals(await client.emitWithAck("ping"), "pong");
  }

  /** Resolves with the payload of the next `event` the client receives. */
  function nextEvent(client: ClientSocket, event: string): Promise<unknown> {
    const { promise, resolve } = Promise.withResolvers<unknown>();

    client.once(event, resolve);

    return promise;
  }

  describe("create()", () => {
    useHarness();

    it("resolves the HTTP server on the first create only", () => {
      const getHttpServer = spy(() => http);
      const lazy = new SocketIoAdapter({ getHttpServer });

      assertSpyCalls(getHttpServer, 0);

      const first = lazy.create({});
      const second = lazy.create({ path: "/other" });

      assertSpyCalls(getHttpServer, 1);
      assertInstanceOf(first, Server);
      assertInstanceOf(second, Server);
      assertStrictEquals(first.httpServer, http);
      assertStrictEquals(second.httpServer, http);
    });

    it("shares one server per path, ignoring a trailing slash", () => {
      const server = adapter.create({});

      assertInstanceOf(server, Server);
      assertEquals(server.path(), "/socket.io");
      assertStrictEquals(adapter.create({ path: "/socket.io/" }), server);
      assertStrictEquals(adapter.create({ path: "/socket.io" }), server);

      const other = adapter.create({ path: "/other/" }) as Server;

      assertNotStrictEquals(other, server);
      assertEquals(other.path(), "/other");
      assertStrictEquals(adapter.create({ path: "/other" }), other);
    });

    it("returns the namespace of the shared server when set", () => {
      const server = adapter.create({}) as Server;
      const chat = adapter.create({ namespace: "/chat" });
      const news = adapter.create({ namespace: "news" });

      assertInstanceOf(chat, Namespace);
      assertInstanceOf(news, Namespace);
      assertEquals(chat.name, "/chat");
      assertEquals(news.name, "/news");
      assertStrictEquals(chat.server, server);
      assertStrictEquals(news.server, server);
      assertStrictEquals(adapter.create({ namespace: "/chat" }), chat);
      assertStrictEquals(adapter.create({ namespace: "" }), server);
    });

    it("merges gateway options over the adapter options", () => {
      const configured = new SocketIoAdapter({ getHttpServer: () => http }, {
        path: "/ws",
        connectTimeout: 1000,
        serveClient: false,
      });
      const server = configured.create({ connectTimeout: 2000 }) as Server;
      const other = configured.create({ path: "/gw" }) as Server;

      assertEquals(server.path(), "/ws");
      assertEquals(server.connectTimeout(), 2000);
      assertEquals(server.serveClient(), false);
      assertEquals(other.path(), "/gw");
      assertEquals(other.connectTimeout(), 1000);
    });

    it("ignores server options of later gateways on the same path", () => {
      const server = adapter.create({}) as Server;

      adapter.create({ namespace: "/chat", connectTimeout: 5 });

      assertEquals(server.connectTimeout(), 45000);
    });

    it("serves clients on the configured path", async () => {
      const configured = new SocketIoAdapter({ getHttpServer: () => http }, {
        path: "/ws",
      });
      const connected = spy((_socket: Socket) => {});

      configured.bindClientConnect(configured.create({}), connected);

      await connect("/", { path: "/ws" });

      assertSpyCalls(connected, 1);
    });
  });

  describe("bindClientConnect()", () => {
    useHarness();

    it("passes the socket and its handshake for the server", async () => {
      const server = adapter.create({});
      const connected = spy((_socket: Socket, ..._args: unknown[]) => {});

      adapter.bindClientConnect(server, connected);

      const client = await connect("/", { auth: { token: "secret" } });
      const [socket, handshake] = connected.calls[0].args;

      assertSpyCalls(connected, 1);
      assertEquals(socket.id, client.id);
      assertEquals(socket.nsp.name, "/");
      assertStrictEquals(handshake, socket.handshake);
      assertEquals(socket.handshake.auth, { token: "secret" });
    });

    it("only reports clients of the gateway's namespace", async () => {
      const main = spy((_socket: Socket) => {});
      const chat = spy((_socket: Socket) => {});

      adapter.bindClientConnect(adapter.create({}), main);
      adapter.bindClientConnect(adapter.create({ namespace: "/chat" }), chat);

      await connect("/chat");

      assertSpyCalls(main, 0);
      assertSpyCalls(chat, 1);
      assertEquals(chat.calls[0].args[0].nsp.name, "/chat");
    });

    it("serves long-polling clients next to plain HTTP requests", async () => {
      const connected = spy((_socket: Socket) => {});

      adapter.bindClientConnect(adapter.create({}), connected);

      const client = await connect("/", { transports: ["polling"] });
      const response = await fetch(`http://127.0.0.1:${port}/plain`);

      assertEquals(client.io.engine.transport.name, "polling");
      assertSpyCalls(connected, 1);
      assertEquals(await response.text(), "ok");
    });
  });

  describe("bindClientDisconnect()", () => {
    useHarness();

    it("calls the callback once the client disconnects", async () => {
      const server = adapter.create({});
      const { promise: disconnected, resolve } = Promise.withResolvers<void>();
      const callback = spy((..._args: unknown[]) => resolve());

      adapter.bindClientConnect(server, (socket: Socket) => {
        adapter.bindClientDisconnect(socket, callback);
      });

      const client = await connect();

      assertSpyCalls(callback, 0);
      client.disconnect();
      await disconnected;

      assertSpyCalls(callback, 1);
      assertSpyCall(callback, 0, { args: [] });
    });
  });

  describe("bindMessageHandlers()", () => {
    useHarness();

    it("routes events to the handler of the same name", async () => {
      const a = spy((_data: unknown) => "a");
      const b = spy((_data: unknown) => "b");
      const client = await connectGateway([handler("a", a), handler("b", b)]);

      assertEquals(await client.emitWithAck("b", { n: 1 }), "b");
      assertSpyCalls(a, 0);
      assertSpyCall(b, 0, { args: [{ n: 1 }] });
    });

    it("passes the first argument as payload", async () => {
      const echo = spy((data: unknown) => ({ data }));
      const client = await connectGateway([handler("echo", echo)]);

      assertEquals(await client.emitWithAck("echo", 1, 2), { data: 1 });
      assertEquals(await client.emitWithAck("echo"), {});
      assertSpyCall(echo, 0, { args: [1] });
      assertSpyCall(echo, 1, { args: [undefined] });
    });

    it("acknowledges null results", async () => {
      const client = await connectGateway([handler("nil", () => null)]);

      assertEquals(await client.emitWithAck("nil"), null);
    });

    it("sends nothing for undefined results", async () => {
      const callback = spy((_data: unknown) => undefined);
      const client = await connectGateway([handler("void", callback)]);
      const ack = spy(() => {});
      const received = spy((..._args: unknown[]) => {});

      client.onAny(received);
      client.emit("void", "data", ack);
      await flush(client);

      assertSpyCalls(callback, 1);
      assertSpyCalls(ack, 0);
      assertSpyCalls(received, 0);
    });

    it("drops results when the client sent no acknowledgement", async () => {
      const callback = spy((_data: unknown) => "result");
      const client = await connectGateway([handler("fire", callback)]);
      const received = spy((..._args: unknown[]) => {});

      client.onAny(received);
      client.emit("fire", "data");
      await flush(client);

      assertSpyCall(callback, 0, { args: ["data"] });
      assertSpyCalls(received, 0);
    });

    it("emits WsResponse results as events", async () => {
      const client = await connectGateway([
        handler("join", (data: unknown) => ({ event: "joined", data })),
      ]);
      const ack = spy(() => {});
      const joined = nextEvent(client, "joined");

      client.emit("join", { room: "lobby" }, ack);

      assertEquals(await joined, { room: "lobby" });
      await flush(client);
      assertSpyCalls(ack, 0);
    });

    it("emits WsException payloads as exception events", async () => {
      const client = await connectGateway([
        handler("fail", () => {
          throw new WsException("Room is full");
        }),
        handler("failObject", () => {
          throw new WsException({ code: "ROOM_FULL" });
        }),
      ]);
      const ack = spy(() => {});
      const first = nextEvent(client, "exception");

      client.emit("fail", "data", ack);

      assertEquals(await first, { status: "error", message: "Room is full" });

      const second = nextEvent(client, "exception");

      client.emit("failObject");

      assertEquals(await second, { code: "ROOM_FULL" });
      await flush(client);
      assertSpyCalls(ack, 0);
    });

    it("emits other failures as internal server errors", async () => {
      const client = await connectGateway([
        handler("crash", () => {
          throw new Error("secret details");
        }),
        handler("reserved", () => ({ event: "disconnect", data: "bye" })),
      ]);
      const internal = { status: "error", message: "Internal server error" };
      const first = nextEvent(client, "exception");

      client.emit("crash");

      assertEquals(await first, internal);

      const second = nextEvent(client, "exception");

      client.emit("reserved");

      assertEquals(await second, internal);
      assertEquals(client.connected, true);
    });

    it("ignores events without a handler", async () => {
      const callback = spy((_data: unknown) => "known");
      const client = await connectGateway([handler("known", callback)]);
      const ack = spy(() => {});

      client.emit("unknown", "data", ack);
      await flush(client);

      assertSpyCalls(ack, 0);
      assertSpyCalls(callback, 0);
      assertEquals(await client.emitWithAck("known"), "known");
    });

    it("routes events per namespace", async () => {
      const main = spy((_data: unknown) => "main");
      const chat = spy((_data: unknown) => "chat");

      await connectGateway([handler("say", main)]);

      const client = await connectGateway([handler("say", chat)], "/chat");

      assertEquals(await client.emitWithAck("say", "hi"), "chat");
      assertSpyCalls(main, 0);
      assertSpyCalls(chat, 1);
    });
  });

  describe("close()", () => {
    useHarness();

    it("disconnects the clients of every gateway namespace once", async () => {
      const server = adapter.create({}) as Server;
      const chat = adapter.create({ namespace: "/chat" }) as Namespace;
      const disconnected = spy((..._args: unknown[]) => {});

      for (const gateway of [server, chat]) {
        adapter.bindClientConnect(gateway, (socket: Socket) => {
          adapter.bindClientDisconnect(socket, disconnected);
        });
      }

      const mainClient = await connect();
      const chatClient = await connect("/chat");
      const reasons = Promise.all([
        nextEvent(mainClient, "disconnect"),
        nextEvent(chatClient, "disconnect"),
      ]);
      const engineClose = spy(server.engine, "close");

      try {
        await adapter.close(chat);
        await adapter.close(server);
      } finally {
        engineClose.restore();
      }

      assertEquals(await reasons, [
        "io server disconnect",
        "io server disconnect",
      ]);
      assertSpyCalls(engineClose, 1);
      assertSpyCalls(disconnected, 2);
    });

    it("keeps the HTTP server and other paths serving", async () => {
      const server = adapter.create({});
      const other = adapter.create({ path: "/other" });

      adapter.bindClientConnect(other, (socket: Socket) => {
        adapter.bindMessageHandlers(socket, [handler("ping", () => "pong")]);
      });

      const client = await connect();
      const otherClient = await connect("/", { path: "/other" });
      const reason = nextEvent(client, "disconnect");

      await adapter.close(server);

      assertEquals(await reason, "io server disconnect");
      assertEquals(http.listening, true);

      const response = await fetch(`http://127.0.0.1:${port}/plain`);

      assertEquals(await response.text(), "ok");
      assertEquals(await otherClient.emitWithAck("ping"), "pong");
    });

    it("leaves the clients of other cluster nodes connected", async () => {
      // A cluster adapter (e.g. Redis) asks every node to disconnect its
      // clients unless the request is flagged local.
      const remote = spy((_opts: DisconnectOptions) => {});
      const InMemoryAdapter = (adapter.create({}) as Server)
        .adapter() as AdapterClass;

      class ClusterAdapter extends InMemoryAdapter {
        public override disconnectSockets(
          opts: DisconnectOptions,
          close: boolean,
        ): void {
          if (!opts.flags?.local) {
            remote(opts);
          }

          super.disconnectSockets(opts, close);
        }
      }

      const cluster = new SocketIoAdapter({ getHttpServer: () => http }, {
        path: "/cluster",
        adapter: ClusterAdapter,
      });
      const server = cluster.create({});
      const client = await connect("/", { path: "/cluster" });
      const reason = nextEvent(client, "disconnect");

      await cluster.close(server);

      assertEquals(await reason, "io server disconnect");
      assertSpyCalls(remote, 0);
    });

    it("ignores servers it did not create", async () => {
      const foreign = new SocketIoAdapter({ getHttpServer: () => http })
        .create({ path: "/foreign" }) as Server;
      const engineClose = spy(foreign.engine, "close");

      try {
        await adapter.close(foreign.of("/chat"));
      } finally {
        engineClose.restore();
      }

      assertSpyCalls(engineClose, 0);
    });

    it("closes a server again once a gateway reopened it", async () => {
      const server = adapter.create({}) as Server;
      const engineClose = spy(server.engine, "close");

      try {
        await adapter.close(server);
        await adapter.close(server);
        assertStrictEquals(adapter.create({}), server);
        await adapter.close(server);
      } finally {
        engineClose.restore();
      }

      assertSpyCalls(engineClose, 2);
    });
  });
});
