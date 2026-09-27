import {
  EventPattern,
  MessageController,
  MessagePattern,
  serializePattern,
} from "@denorid/core/microservices";
import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals, assertRejects } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
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

/** Collects every response frame until the server closes the connection. */
async function responsesOf(socket: Socket): Promise<unknown[]> {
  const responses: unknown[] = [];

  for await (const body of readFrames(socket)) {
    responses.push(decodeFrame(body, deserializer));
  }

  return responses;
}

/**
 * Writes `bytes`, half-closes the socket and collects every response frame
 * until the server closes the connection.
 */
function exchange(socket: Socket, ...bytes: Uint8Array[]): Promise<unknown[]> {
  for (const chunk of bytes) {
    socket.write(chunk);
  }

  socket.end();

  return responsesOf(socket);
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

    it("serves again when called after close()", async () => {
      const server = withController(new TcpServer({ port: 0 }), PingController);
      const first = await start(server);

      await server.close();
      await first.stopped;

      const { port } = await start(server);

      assertEquals(
        await exchange(await connectTo(port), message("ping", "again", "id-1")),
        [{ id: "id-1", isDisposed: true, response: "pong:again" }],
      );
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

    it("delivers the responses of running handlers before closing connections", async () => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();

      @MessageController()
      class SlowCtrl {
        @MessagePattern("slow")
        public async slow(): Promise<string> {
          started.resolve();
          await release.promise;
          return "done";
        }
      }

      const server = withController(new TcpServer({ port: 0 }), SlowCtrl);
      const { port, stopped } = await start(server);
      const client = await connectTo(port);
      const responses = responsesOf(client);

      client.write(message("slow", null, "id-1"));
      await started.promise;

      const closing = server.close();

      release.resolve();
      await closing;
      await stopped;

      assertEquals(await responses, [
        { id: "id-1", isDisposed: true, response: "done" },
      ]);
    });

    it("drops frames received after it started", async () => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const handled: unknown[] = [];

      @MessageController()
      class Ctrl {
        @MessagePattern("slow")
        public async slow(): Promise<string> {
          started.resolve();
          await release.promise;
          return "done";
        }

        @MessagePattern("ping")
        public ping(data: unknown): unknown {
          handled.push(data);
          return data;
        }
      }

      const server = withController(new TcpServer({ port: 0 }), Ctrl);
      const { port } = await start(server);
      const accepted = once(server["netServer"]!, "connection");
      const busy = await connectTo(port);

      await accepted;

      const acceptedIdle = once(server["netServer"]!, "connection");
      const idle = await connectTo(port);

      await acceptedIdle;

      const busyResponses = responsesOf(busy);

      busy.write(message("slow", null, "slow-id"));
      await started.promise;

      const closing = server.close();

      // Nothing runs on `idle`, so dropping the frame closes it right away.
      assertEquals(
        await exchange(idle, message("ping", "late", "late-id")),
        [],
      );

      release.resolve();
      await closing;

      assertEquals(handled, []);
      assertEquals(await busyResponses, [
        { id: "slow-id", isDisposed: true, response: "done" },
      ]);
    });

    it("waits for running event handlers", async () => {
      const started = Promise.withResolvers<void>();
      const order: string[] = [];

      @MessageController()
      class SlowEvtCtrl {
        @EventPattern("slow.evt")
        public async onEvent(): Promise<void> {
          started.resolve();
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          order.push("handled");
        }
      }

      const server = withController(new TcpServer({ port: 0 }), SlowEvtCtrl);
      const { port } = await start(server);
      const client = await connectTo(port);

      client.write(event("slow.evt", null));
      await started.promise;
      await server.close();
      order.push("closed");

      assertEquals(order, ["handled", "closed"]);
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

    it("answers several requests from a single chunk", async () => {
      const server = withController(new TcpServer({ port: 0 }), PingController);
      const { port } = await start(server);
      const first = message("ping", 1, "id-1");
      const second = message("ping", 2, "id-2");
      const chunk = new Uint8Array(first.byteLength + second.byteLength);

      chunk.set(first);
      chunk.set(second, first.byteLength);

      const responses = await exchange(await connectTo(port), chunk);
      const byId: unknown[] = (responses as { id: string }[]).toSorted(
        (a, b) => a.id.localeCompare(b.id),
      );

      assertEquals(byId, [
        { id: "id-1", isDisposed: true, response: "pong:1" },
        { id: "id-2", isDisposed: true, response: "pong:2" },
      ]);
    });

    it("answers a fast request while a slow one on the same connection runs", async () => {
      const release = Promise.withResolvers<void>();

      @MessageController()
      class MixedCtrl {
        @MessagePattern("slow")
        public async slow(): Promise<string> {
          await release.promise;
          return "slow";
        }

        @MessagePattern("fast")
        public fast(): string {
          return "fast";
        }
      }

      const server = withController(new TcpServer({ port: 0 }), MixedCtrl);
      const { port } = await start(server);
      const client = await connectTo(port);
      const frames = readFrames(client);

      client.write(message("slow", null, "slow-id"));
      client.write(message("fast", null, "fast-id"));

      // Serving one request at a time answers nothing before the slow handler
      // returns: release it eventually so that fails instead of hanging.
      const fallback = setTimeout(release.resolve, 1_000);
      const first = await frames.next();

      clearTimeout(fallback);
      release.resolve();

      const second = await frames.next();

      assertEquals(
        [first.value, second.value].map((body) =>
          decodeFrame(body as Uint8Array, deserializer)
        ),
        [
          { id: "fast-id", isDisposed: true, response: "fast" },
          { id: "slow-id", isDisposed: true, response: "slow" },
        ],
      );
    });

    it("omits the response field when the handler returns undefined", async () => {
      @MessageController()
      class VoidCtrl {
        @MessagePattern("void")
        public handle(): void {}
      }

      const server = withController(new TcpServer({ port: 0 }), VoidCtrl);
      const { port } = await start(server);

      assertEquals(
        await exchange(await connectTo(port), message("void", null, "void-id")),
        [{ id: "void-id", isDisposed: true }],
      );
    });

    it("writes and logs a serialization error when the response cannot be encoded", async () => {
      @MessageController()
      class DateCtrl {
        @MessagePattern("date")
        public date(): { at: Date } {
          return { at: new Date(0) };
        }
      }

      const server = withController(new TcpServer({ port: 0 }), DateCtrl);
      using logError = spy(server["logger"], "error");
      const { port } = await start(server);

      assertEquals(
        await exchange(await connectTo(port), message("date", null, "date-id")),
        [{
          id: "date-id",
          isDisposed: true,
          err:
            "Failed to serialize response: Cannot safely encode value into messagepack",
        }],
      );
      assertEquals(logError.calls.length, 1);
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

    it("closes the connection when a frame exceeds maxBufferSize", async () => {
      const server = withController(
        new TcpServer({ port: 0, maxBufferSize: 40 }),
        PingController,
      );
      const { port } = await start(server);

      assertEquals(
        await exchange(await connectTo(port), message("ping", "ok", "id-1")),
        [{ id: "id-1", isDisposed: true, response: "pong:ok" }],
      );
      assertEquals(
        await exchange(
          await connectTo(port),
          message("ping", "x".repeat(64), "id-2"),
        ),
        [],
      );
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
