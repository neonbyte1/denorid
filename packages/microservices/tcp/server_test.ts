import {
  EventPattern,
  MessageController,
  MessagePattern,
  serializePattern,
} from "@denorid/core/microservices";
import type { Type } from "@denorid/injector";
import { assertEquals } from "@std/assert";
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { mockStdWrite, type RestoreFn } from "../_test_utils.ts";
import { encodeFrame } from "./_codec.ts";
import { TcpSerializer } from "./serializer.ts";
import { TcpServer } from "./server.ts";

const serializer = new TcpSerializer();

interface FakeConn {
  written: Uint8Array[];
  closed: boolean;
}

function makePreloadedConn(
  chunks: Array<Uint8Array | null | Error>,
): { conn: Deno.TcpConn; state: FakeConn } {
  const state: FakeConn = { written: [], closed: false };
  let readIdx = 0;

  const conn: Deno.TcpConn = {
    read: (p: Uint8Array): Promise<number | null> => {
      if (readIdx >= chunks.length) return Promise.resolve(null);
      const item = chunks[readIdx++];
      if (item instanceof Error) return Promise.reject(item);
      if (item === null) return Promise.resolve(null);
      const n = Math.min(item.length, p.length);
      p.set(item.subarray(0, n));
      return Promise.resolve(n);
    },
    write: (buf: Uint8Array): Promise<number> => {
      state.written.push(new Uint8Array(buf));
      return Promise.resolve(buf.byteLength);
    },
    close: () => {
      state.closed = true;
    },
  } as unknown as Deno.TcpConn;

  return { conn, state };
}

function frameChunks(payload: Record<string, unknown>): Uint8Array[] {
  const encoded = encodeFrame(payload, serializer);
  return [encoded.subarray(0, 4), encoded.subarray(4)];
}

function makeSingleConnListener(conn: Deno.TcpConn): Deno.TcpListener {
  let yielded = false;
  let closeResolve!: () => void;
  const closePromise = new Promise<void>((r) => {
    closeResolve = r;
  });
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async (): Promise<IteratorResult<Deno.TcpConn>> => {
          if (!yielded) {
            yielded = true;
            return { done: false, value: conn };
          }
          await closePromise;
          return { done: true, value: undefined as unknown as Deno.TcpConn };
        },
      };
    },
    close: () => {
      closeResolve();
    },
  } as unknown as Deno.TcpListener;
}

describe("TcpServer", () => {
  let restoreStdout: RestoreFn;
  let restoreStderr: RestoreFn;

  beforeAll(() => {
    restoreStdout = mockStdWrite(Deno.stdout);
    restoreStderr = mockStdWrite(Deno.stderr);
  });

  afterAll(() => {
    restoreStdout();
    restoreStderr();
  });

  describe("close()", () => {
    it("closes the listener and clears connections", async () => {
      let listenerClosed = false;
      const fakeListener = {
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.resolve({ done: true, value: undefined }),
          };
        },
        close: () => {
          listenerClosed = true;
        },
      } as unknown as Deno.TcpListener;

      using _s = stub(Deno, "listen", (() => fakeListener) as never);

      const server = new TcpServer({ host: "127.0.0.1", port: 9999 });
      server.listen();
      await new Promise<void>((r) => setTimeout(r, 5));
      await server.close();

      assertEquals(listenerClosed, true);
    });

    it("is safe to call when listener is undefined", async () => {
      const server = new TcpServer({});
      await server.close();
    });
  });

  describe("listen() - message handling", () => {
    it("dispatches a message frame and writes a response", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("ping")
        ping(data: unknown): string {
          return `pong:${data}`;
        }
      }

      const pattern = serializePattern("ping");
      const msgId = "test-id-123";
      const { conn, state } = makePreloadedConn([
        ...frameChunks({ pattern, data: "world", id: msgId }),
        null,
      ]);

      using _s = stub(
        Deno,
        "listen",
        (() => makeSingleConnListener(conn)) as never,
      );

      const server = new TcpServer({ host: "127.0.0.1", port: 9999 });
      server.registerHandlers([Ctrl as unknown as Type], [new Ctrl()]);

      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 30));
      await server.close();
      await listenPromise.catch(() => {});

      assertEquals(state.written.length > 0, true);

      const { decode } = await import("@std/msgpack");
      const responseFrame = decode(
        state.written[0].subarray(4),
      ) as Record<string, unknown>;

      assertEquals(responseFrame.id, msgId);
      assertEquals(responseFrame.response, "pong:world");
    });

    it("writes an error response when handler throws", async () => {
      @MessageController()
      class ErrCtrl {
        @MessagePattern("boom")
        fail(): never {
          throw new Error("handler error");
        }
      }

      const pattern = serializePattern("boom");
      const { conn, state } = makePreloadedConn([
        ...frameChunks({ pattern, data: null, id: "err-id" }),
        null,
      ]);

      using _s = stub(
        Deno,
        "listen",
        (() => makeSingleConnListener(conn)) as never,
      );

      const server = new TcpServer({});
      server.registerHandlers([ErrCtrl as unknown as Type], [new ErrCtrl()]);

      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 30));
      await server.close();
      await listenPromise.catch(() => {});

      const { decode } = await import("@std/msgpack");
      const errFrame = decode(
        state.written[0].subarray(4),
      ) as Record<string, unknown>;

      assertEquals(errFrame.err, "handler error");
    });

    it("writes an error response with non-Error throw as string", async () => {
      @MessageController()
      class StrErrCtrl {
        @MessagePattern("str-err")
        fail(): never {
          throw "string error";
        }
      }

      const pattern = serializePattern("str-err");
      const { conn, state } = makePreloadedConn([
        ...frameChunks({ pattern, data: null, id: "str-id" }),
        null,
      ]);

      using _s = stub(
        Deno,
        "listen",
        (() => makeSingleConnListener(conn)) as never,
      );

      const server = new TcpServer({});
      server.registerHandlers([StrErrCtrl as unknown as Type], [
        new StrErrCtrl(),
      ]);

      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 30));
      await server.close();
      await listenPromise.catch(() => {});

      const { decode } = await import("@std/msgpack");
      const errFrame = decode(
        state.written[0].subarray(4),
      ) as Record<string, unknown>;

      assertEquals(errFrame.err, "string error");
    });

    it("dispatches an event frame without writing a response", async () => {
      const received: unknown[] = [];

      @MessageController()
      class EvCtrl {
        @EventPattern("evt.fired")
        onEvent(data: unknown): void {
          received.push(data);
        }
      }

      const pattern = serializePattern("evt.fired");
      const { conn, state } = makePreloadedConn([
        ...frameChunks({ pattern, data: "payload" }),
        null,
      ]);

      using _s = stub(
        Deno,
        "listen",
        (() => makeSingleConnListener(conn)) as never,
      );

      const server = new TcpServer({});
      server.registerHandlers([EvCtrl as unknown as Type], [new EvCtrl()]);

      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 30));
      await server.close();
      await listenPromise.catch(() => {});

      assertEquals(received.length, 1);
      assertEquals(received[0], "payload");
      // Event frames get no response
      assertEquals(state.written.length, 0);
    });

    it("closes connection when frame decode fails", async () => {
      const invalidBody = new Uint8Array([0xc1]);
      const header = new Uint8Array(4);
      new DataView(header.buffer).setUint32(0, invalidBody.length, false);

      const { conn, state } = makePreloadedConn([header, invalidBody, null]);

      using _s = stub(
        Deno,
        "listen",
        (() => makeSingleConnListener(conn)) as never,
      );

      const server = new TcpServer({});
      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 30));
      await server.close();
      await listenPromise.catch(() => {});

      assertEquals(state.closed, true);
    });

    it("handles write failure on response gracefully", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("safe")
        handle(): string {
          return "ok";
        }
      }

      const pattern = serializePattern("safe");
      const { conn } = makePreloadedConn([
        ...frameChunks({ pattern, data: null, id: "x" }),
        null,
      ]);

      (conn as unknown as Record<string, unknown>)["write"] = () =>
        Promise.reject(new Error("broken pipe"));

      using _s = stub(
        Deno,
        "listen",
        (() => makeSingleConnListener(conn)) as never,
      );

      const server = new TcpServer({});
      server.registerHandlers([Ctrl as unknown as Type], [new Ctrl()]);

      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 30));
      await server.close();
      await listenPromise.catch(() => {});
    });

    it("swallows event dispatch errors when no handler is registered", async () => {
      const pattern = serializePattern("unregistered.evt");
      const { conn } = makePreloadedConn([
        ...frameChunks({ pattern, data: null }), // no id → treated as event
        null,
      ]);

      using _s = stub(
        Deno,
        "listen",
        (() => makeSingleConnListener(conn)) as never,
      );

      const server = new TcpServer({});
      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 30));
      await server.close();
      await listenPromise.catch(() => {});
    });

    it("handles already-closed connection gracefully on close()", async () => {
      const { conn, state: _state } = makePreloadedConn([null]);
      (conn as unknown as Record<string, unknown>)["close"] = () => {
        throw new Error("already closed");
      };

      using _s = stub(
        Deno,
        "listen",
        (() => makeSingleConnListener(conn)) as never,
      );

      const server = new TcpServer({});
      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 30));
      await server.close();
      await listenPromise.catch(() => {});
    });
  });
});
