import {
  EventPattern,
  MessageController,
  MessagePattern,
  serializePattern,
} from "@denorid/core/microservices";
import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals, assertRejects } from "@std/assert";
import { stub } from "@std/testing/mock";
import { once } from "node:events";
import net, { type AddressInfo, type Socket } from "node:net";
import process from "node:process";
import { after, afterEach, before, describe, it } from "node:test";
import { mockStdWrite, type RestoreFn } from "../_test_utils.ts";
import { decodeFrame, encodeFrame, readFrames } from "./_codec.ts";
import { TcpDeserializer } from "./deserializer.ts";
import { TcpSerializer } from "./serializer.ts";
import { TcpServer } from "./server.ts";

const serializer = new TcpSerializer();
const deserializer = new TcpDeserializer();

const servers: TcpServer[] = [];
const sockets: Socket[] = [];

function makeCtx(instance: unknown): InjectorContext {
  return {
    runInRequestScopeAsync: (_id: string, fn: () => Promise<unknown>) => fn(),
    getHostModuleRef: () => ({
      get: (_type: Type, _opts: unknown) => Promise.resolve(instance),
    }),
    clearContext: () => {},
  } as unknown as InjectorContext;
}

function withController<T extends object>(
  server: TcpServer,
  controller: new () => T,
): TcpServer {
  server.registerHandlers(
    [controller as unknown as Type],
    makeCtx(new controller()),
  );

  return server;
}

/**
 * Starts `server` on the port from its options and waits until it accepts
 * connections.
 */
async function start(
  server: TcpServer,
): Promise<{ port: number; stopped: Promise<void> }> {
  servers.push(server);

  const stopped = server.listen();
  const netServer = server["netServer"]!;

  await once(netServer, "listening");

  return { port: (netServer.address() as AddressInfo).port, stopped };
}

async function connectTo(port: number): Promise<Socket> {
  const socket = net.connect({ host: "127.0.0.1", port });

  sockets.push(socket);
  await once(socket, "connect");

  return socket;
}

function message(pattern: string, data: unknown, id: string): Uint8Array {
  return encodeFrame(
    { pattern: serializePattern(pattern), data, id },
    serializer,
  );
}

function event(pattern: string, data: unknown): Uint8Array {
  return encodeFrame({ pattern: serializePattern(pattern), data }, serializer);
}

/**
 * Writes `bytes`, half-closes the socket and collects every response frame
 * until the server closes the connection.
 */
async function exchange(
  socket: Socket,
  ...bytes: Uint8Array[]
): Promise<unknown[]> {
  for (const chunk of bytes) {
    socket.write(chunk);
  }

  socket.end();

  const responses: unknown[] = [];

  for await (const body of readFrames(socket)) {
    responses.push(decodeFrame(body, deserializer));
  }

  return responses;
}

function registerCleanup(): void {
  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.destroy();
    }

    await Promise.all(servers.splice(0).map((server) => server.close()));
  });
}

@MessageController()
class PingController {
  @MessagePattern("ping")
  public ping(data: unknown): string {
    return `pong:${data}`;
  }
}

describe(TcpServer.name, () => {
  let restoreStdout: RestoreFn;
  let restoreStderr: RestoreFn;

  before(() => {
    restoreStdout = mockStdWrite(process.stdout);
    restoreStderr = mockStdWrite(process.stderr);
  });

  after(() => {
    restoreStdout();
    restoreStderr();
  });

  describe("listen()", () => {
    registerCleanup();

    it("serves until close() and then releases the port", async () => {
      const server = new TcpServer({ host: "127.0.0.1", port: 0 });
      const { port, stopped } = await start(server);

      await server.close();
      await stopped;

      const refused = net.connect({ host: "127.0.0.1", port });
      const [err] = await once(refused, "error");

      assertEquals((err as { code?: string }).code, "ECONNREFUSED");
    });

    it("defaults to 127.0.0.1:3000", async () => {
      const realCreateServer = net.createServer;
      let bound: unknown[] = [];
      using _createServer = stub(
        net,
        "createServer",
        ((options: net.ServerOpts, listener: (socket: Socket) => void) => {
          const netServer = realCreateServer(options, listener);
          const realListen = netServer.listen.bind(netServer) as (
            port: number,
            host: string,
            callback: () => void,
          ) => net.Server;

          netServer.listen = ((
            port: number,
            host: string,
            callback: () => void,
          ) => {
            bound = [host, port];
            return realListen(0, host, callback);
          }) as never;

          return netServer;
        }) as never,
      );

      await start(new TcpServer({}));

      assertEquals(bound, ["127.0.0.1", 3000]);
    });

    it("rejects when the port is already in use", async () => {
      const { port } = await start(new TcpServer({ port: 0 }));
      const second = new TcpServer({ port });

      servers.push(second);

      const err = await assertRejects(() => second.listen());

      assertEquals((err as { code?: string }).code, "EADDRINUSE");
    });

    it("rejects when the server fails after listening", async () => {
      const server = new TcpServer({ port: 0 });
      const { stopped } = await start(server);

      server["netServer"]!.emit("error", new Error("accept failed"));

      await assertRejects(() => stopped, Error, "accept failed");
    });
  });

  describe("close()", () => {
    registerCleanup();

    it("is safe to call before listen()", async () => {
      await new TcpServer({}).close();
    });

    it("destroys open connections", async () => {
      const server = new TcpServer({ port: 0 });
      const { port, stopped } = await start(server);
      const accepted = once(server["netServer"]!, "connection");
      const client = await connectTo(port);

      await accepted;

      const clientClosed = once(client, "close");

      await server.close();
      await clientClosed;
      await stopped;
    });
  });

  describe("message handling", () => {
    registerCleanup();

    it("dispatches a message frame and writes the response", async () => {
      const server = withController(new TcpServer({ port: 0 }), PingController);
      const { port } = await start(server);

      assertEquals(
        await exchange(await connectTo(port), message("ping", "world", "id-1")),
        [{ id: "id-1", isDisposed: true, response: "pong:world" }],
      );
    });

    it("answers several requests from a single chunk in order", async () => {
      const server = withController(new TcpServer({ port: 0 }), PingController);
      const { port } = await start(server);
      const first = message("ping", 1, "id-1");
      const second = message("ping", 2, "id-2");
      const chunk = new Uint8Array(first.byteLength + second.byteLength);

      chunk.set(first);
      chunk.set(second, first.byteLength);

      assertEquals(await exchange(await connectTo(port), chunk), [
        { id: "id-1", isDisposed: true, response: "pong:1" },
        { id: "id-2", isDisposed: true, response: "pong:2" },
      ]);
    });

    it("writes the error message when the handler throws an Error", async () => {
      @MessageController()
      class ErrCtrl {
        @MessagePattern("boom")
        public fail(): never {
          throw new Error("handler error");
        }
      }

      const server = withController(new TcpServer({ port: 0 }), ErrCtrl);
      const { port } = await start(server);

      assertEquals(
        await exchange(await connectTo(port), message("boom", null, "err-id")),
        [{ id: "err-id", isDisposed: true, err: "handler error" }],
      );
    });

    it("writes a stringified error when the handler throws a non-Error", async () => {
      @MessageController()
      class StrErrCtrl {
        @MessagePattern("str-err")
        public fail(): never {
          throw "string error";
        }
      }

      const server = withController(new TcpServer({ port: 0 }), StrErrCtrl);
      const { port } = await start(server);

      assertEquals(
        await exchange(
          await connectTo(port),
          message("str-err", null, "str-id"),
        ),
        [{ id: "str-id", isDisposed: true, err: "string error" }],
      );
    });

    it("dispatches event frames without writing a response", async () => {
      const received = Promise.withResolvers<unknown>();

      @MessageController()
      class EvCtrl {
        @EventPattern("evt.fired")
        public onEvent(data: unknown): void {
          received.resolve(data);
        }
      }

      const server = withController(new TcpServer({ port: 0 }), EvCtrl);
      const { port } = await start(server);

      assertEquals(
        await exchange(await connectTo(port), event("evt.fired", "payload")),
        [],
      );
      assertEquals(await received.promise, "payload");
    });

    it("keeps serving after an event without a registered handler", async () => {
      const server = withController(new TcpServer({ port: 0 }), PingController);
      const { port } = await start(server);

      assertEquals(
        await exchange(
          await connectTo(port),
          event("unregistered.evt", null),
          message("ping", "still-alive", "id-1"),
        ),
        [{ id: "id-1", isDisposed: true, response: "pong:still-alive" }],
      );
    });

    it("closes the connection when a frame cannot be decoded", async () => {
      const server = withController(new TcpServer({ port: 0 }), PingController);
      const { port } = await start(server);

      assertEquals(
        await exchange(
          await connectTo(port),
          new Uint8Array([0, 0, 0, 1, 0xc1]),
          message("ping", "ignored", "id-1"),
        ),
        [],
      );
    });

    it("closes the connection when a frame exceeds 64 MiB", async () => {
      const server = withController(new TcpServer({ port: 0 }), PingController);
      const { port } = await start(server);
      const client = await connectTo(port);
      const clientClosed = once(client, "close");

      client.write(new Uint8Array([0x04, 0x00, 0x00, 0x01]));

      await clientClosed;
    });

    it("keeps serving when a response cannot be written", async () => {
      const server = withController(new TcpServer({ port: 0 }), PingController);
      const { port } = await start(server);
      const accepted = once(server["netServer"]!, "connection");
      const broken = await connectTo(port);
      const [serverSide] = await accepted;
      using _write = stub(
        serverSide as Socket,
        "write",
        ((_data: Uint8Array, callback: (err: Error) => void) => {
          callback(new Error("broken pipe"));
          return false;
        }) as never,
      );

      assertEquals(
        await exchange(broken, message("ping", "lost", "id-1")),
        [],
      );
      assertEquals(
        await exchange(await connectTo(port), message("ping", "ok", "id-2")),
        [{ id: "id-2", isDisposed: true, response: "pong:ok" }],
      );
    });

    it("keeps serving when an accepted connection fails", async () => {
      const server = withController(new TcpServer({ port: 0 }), PingController);
      const { port } = await start(server);
      const accepted = once(server["netServer"]!, "connection");
      const failing = await connectTo(port);
      const [serverSide] = await accepted;
      const failingClosed = once(failing, "close");

      (serverSide as Socket).destroy(new Error("connection reset"));

      await failingClosed;
      assertEquals(
        await exchange(await connectTo(port), message("ping", "ok", "id-1")),
        [{ id: "id-1", isDisposed: true, response: "pong:ok" }],
      );
    });
  });
});
