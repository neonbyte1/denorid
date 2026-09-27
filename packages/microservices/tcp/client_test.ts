import { assertEquals, assertRejects } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import { once } from "node:events";
import net, { type AddressInfo, type Socket } from "node:net";
import { afterEach, describe, it } from "node:test";
import { decodeFrame, encodeFrame, readFrames } from "./_codec.ts";
import { TcpClient } from "./client.ts";
import { TcpDeserializer } from "./deserializer.ts";
import type { TcpOptions } from "./options.ts";
import { TcpSerializer } from "./serializer.ts";

const serializer = new TcpSerializer();
const deserializer = new TcpDeserializer();

interface RequestFrame {
  pattern: string;
  data: unknown;
  id?: string;
}

type Reply = (socket: Socket, frame: RequestFrame) => void;

/** Loopback stand-in for a `TcpServer` whose replies are scripted per test. */
interface Peer {
  port: number;
  /** Server side of every connection accepted so far. */
  sockets: Socket[];
  /** Resolves with the server side of the next accepted connection. */
  nextConnection: () => Promise<Socket>;
  close: () => Promise<void>;
}

const peers: Peer[] = [];
const clients: TcpClient[] = [];

async function startPeer(reply: Reply = () => {}): Promise<Peer> {
  const sockets: Socket[] = [];
  const server = net.createServer(async (socket: Socket) => {
    sockets.push(socket);

    for await (const body of readFrames(socket)) {
      reply(socket, decodeFrame(body, deserializer) as RequestFrame);
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const peer: Peer = {
    port: (server.address() as AddressInfo).port,
    sockets,
    nextConnection: async () => {
      const [socket] = await once(server, "connection");
      return socket as Socket;
    },
    close: async () => {
      const closed = once(server, "close");

      for (const socket of sockets) {
        socket.destroy();
      }

      server.close();
      await closed;
    },
  };

  peers.push(peer);

  return peer;
}

function createClient(options: TcpOptions): TcpClient {
  const client = new TcpClient(options);

  clients.push(client);

  return client;
}

function respond(socket: Socket, frame: Record<string, unknown>): void {
  socket.write(encodeFrame({ isDisposed: true, ...frame }, serializer));
}

async function closedPort(): Promise<number> {
  const server = net.createServer();

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  server.close();
  await once(server, "close");

  return port;
}

function registerCleanup(): void {
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await Promise.all(peers.splice(0).map((peer) => peer.close()));
  });
}

describe(TcpClient.name, () => {
  describe("connect()", () => {
    registerCleanup();

    it("opens a connection to the configured host and port", async () => {
      const peer = await startPeer();
      const client = createClient({ host: "127.0.0.1", port: peer.port });
      const accepted = peer.nextConnection();

      await client.connect();

      assertEquals((await accepted).remotePort, client["socket"]!.localPort);
    });

    it("shares a single connection between concurrent calls", async () => {
      const peer = await startPeer();
      const client = createClient({ port: peer.port });
      using connectSpy = spy(net, "connect");

      await Promise.all([client.connect(), client.connect()]);

      assertEquals(connectSpy.calls.length, 1);
    });

    it("retries on failure and eventually throws the last error", async () => {
      const port = await closedPort();
      const client = createClient({ port, retryAttempts: 2, retryDelay: 1 });
      using connectSpy = spy(net, "connect");

      const err = await assertRejects(() => client.connect());

      assertEquals((err as { code?: string }).code, "ECONNREFUSED");
      assertEquals(connectSpy.calls.length, 3);
    });

    it("defaults to 127.0.0.1:3000", async () => {
      const peer = await startPeer();
      const realConnect = net.connect;
      let captured: unknown;
      using _connect = stub(
        net,
        "connect",
        ((options: net.TcpNetConnectOpts) => {
          captured = options;
          return realConnect({ host: "127.0.0.1", port: peer.port });
        }) as never,
      );

      await createClient({}).connect();

      assertEquals(captured, { host: "127.0.0.1", port: 3000 });
    });
  });

  describe("close()", () => {
    registerCleanup();

    it("is a no-op when not connected", async () => {
      await new TcpClient({}).close();
    });

    it("rejects pending requests and closes the socket", async () => {
      const received = Promise.withResolvers<Socket>();
      const peer = await startPeer((socket) => received.resolve(socket));
      const client = createClient({ port: peer.port });

      const pending = assertRejects(
        () => client.send("never.answered", null),
        Error,
        "Connection closed",
      );
      const serverSide = await received.promise;
      const serverSideClosed = once(serverSide, "close");

      await client.close();
      await pending;
      await serverSideClosed;
    });

    it("reconnects on first use after closing", async () => {
      const peer = await startPeer((socket, frame) =>
        respond(socket, { id: frame.id, response: frame.data })
      );
      const client = createClient({ port: peer.port });

      await client.connect();
      await client.close();

      assertEquals(await client.send("echo", "again"), "again");
      assertEquals(peer.sockets.length, 2);
    });
  });

  describe("send()", () => {
    registerCleanup();

    it("connects on first use and resolves with the response", async () => {
      const peer = await startPeer((socket, frame) =>
        respond(socket, { id: frame.id, response: `pong:${frame.data}` })
      );
      const client = createClient({ port: peer.port });

      assertEquals(await client.send<string>("ping", "world"), "pong:world");
    });

    it("sends the serialized pattern, the payload and a correlation id", async () => {
      const received = Promise.withResolvers<RequestFrame>();
      const peer = await startPeer((socket, frame) => {
        received.resolve(frame);
        respond(socket, { id: frame.id, response: null });
      });
      const client = createClient({ port: peer.port });

      await client.send({ cmd: "sum" }, [1, 2]);

      const frame = await received.promise;

      assertEquals(frame.pattern, '{"cmd":"sum"}');
      assertEquals(frame.data, [1, 2]);
      assertEquals(typeof frame.id, "string");
    });

    it("routes out-of-order responses by correlation id", async () => {
      const requests: Array<{ socket: Socket; frame: RequestFrame }> = [];
      const peer = await startPeer((socket, frame) => {
        requests.push({ socket, frame });

        if (requests.length === 2) {
          for (const request of requests.toReversed()) {
            respond(request.socket, {
              id: request.frame.id,
              response: `re:${request.frame.data}`,
            });
          }
        }
      });
      const client = createClient({ port: peer.port });

      await client.connect();

      assertEquals(
        await Promise.all([client.send("a", 1), client.send("b", 2)]),
        ["re:1", "re:2"],
      );
    });

    it("rejects with the error message returned by the server", async () => {
      const peer = await startPeer((socket, frame) =>
        respond(socket, { id: frame.id, err: "server exploded" })
      );
      const client = createClient({ port: peer.port });

      await assertRejects(
        () => client.send("op", {}),
        Error,
        "server exploded",
      );
    });

    it("resolves undefined when the response frame carries no response", async () => {
      const peer = await startPeer((socket, frame) =>
        respond(socket, { id: frame.id })
      );
      const client = createClient({ port: peer.port });

      assertEquals(await client.send("void", null), undefined);
    });

    it("rejects when the request cannot be written", async () => {
      const peer = await startPeer();
      const client = createClient({ port: peer.port });

      await client.connect();

      using _write = stub(
        client["socket"]!,
        "write",
        ((_data: Uint8Array, callback: (err: Error) => void) => {
          callback(new Error("write failed"));
          return false;
        }) as never,
      );

      await assertRejects(() => client.send("pat", {}), Error, "write failed");
    });

    it("rejects without tracking the request when the payload cannot be encoded", async () => {
      const peer = await startPeer();
      const client = createClient({ port: peer.port });

      await client.connect();
      await assertRejects(
        () => client.send("pat", { at: new Date(0) }),
        Error,
        "Cannot safely encode",
      );
      assertEquals(client["pending"].size, 0);
    });
  });

  describe("emit()", () => {
    registerCleanup();

    it("connects on first use and writes an event frame without id", async () => {
      const received = Promise.withResolvers<RequestFrame>();
      const peer = await startPeer((_socket, frame) => received.resolve(frame));
      const client = createClient({ port: peer.port });

      await client.emit("event.fired", { payload: 1 });

      assertEquals(await received.promise, {
        pattern: "event.fired",
        data: { payload: 1 },
      });
    });
  });

  describe("[Symbol.asyncDispose]()", () => {
    registerCleanup();

    it("closes the connection when the client goes out of scope", async () => {
      const peer = await startPeer();
      const accepted = peer.nextConnection();
      let serverSideClosed: Promise<unknown[]>;

      {
        await using client = new TcpClient({ port: peer.port });

        await client.connect();
        serverSideClosed = once(await accepted, "close");
      }

      await serverSideClosed;
    });
  });

  describe("response handling", () => {
    registerCleanup();

    it("ignores undecodable frames and keeps reading", async () => {
      const peer = await startPeer((socket, frame) => {
        socket.write(new Uint8Array([0, 0, 0, 1, 0xc1]));
        respond(socket, { id: frame.id, response: "after-garbage" });
      });
      const client = createClient({ port: peer.port });

      assertEquals(await client.send("x", null), "after-garbage");
    });

    it("ignores responses with an unknown correlation id", async () => {
      const peer = await startPeer((socket, frame) => {
        respond(socket, { id: "unknown-id", response: "ignored" });
        respond(socket, { id: frame.id, response: "matched" });
      });
      const client = createClient({ port: peer.port });

      assertEquals(await client.send("x", null), "matched");
    });

    it("rejects pending requests when the server drops the connection", async () => {
      let requests = 0;
      const peer = await startPeer((socket, frame) => {
        requests++;

        if (requests === 1) {
          socket.destroy();
        } else {
          respond(socket, { id: frame.id, response: "recovered" });
        }
      });
      const client = createClient({ port: peer.port });

      await assertRejects(
        () => client.send("x", null),
        Error,
        "Connection closed",
      );
      assertEquals(await client.send("x", null), "recovered");
      assertEquals(peer.sockets.length, 2);
    });

    it("drops the connection when the server sends an oversized frame", async () => {
      const received = Promise.withResolvers<Socket>();
      const peer = await startPeer((socket) => {
        received.resolve(socket);
        socket.write(new Uint8Array([0x04, 0x00, 0x00, 0x01]));
      });
      const client = createClient({ port: peer.port });

      await assertRejects(
        () => client.send("x", null),
        Error,
        "Connection closed",
      );
      await once(await received.promise, "close");
    });

    it("drops the connection when a response exceeds maxBufferSize", async () => {
      const peer = await startPeer((socket, frame) =>
        respond(socket, { id: frame.id, response: frame.data })
      );
      const client = createClient({ port: peer.port, maxBufferSize: 128 });

      assertEquals(await client.send("echo", "fits"), "fits");
      await assertRejects(
        () => client.send("echo", "x".repeat(200)),
        Error,
        "Connection closed",
      );
    });
  });
});
