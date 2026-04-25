import {
  EventPattern,
  MessageController,
  MessagePattern,
  serializePattern,
} from "@denorid/core/microservices";
import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals } from "@std/assert";
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { spy, stub } from "@std/testing/mock";
import amqplib from "amqplib";
import { Buffer } from "node:buffer";
import { mockStdWrite, type RestoreFn } from "../_test_utils.ts";
import { RmqSerializer } from "./serializer.ts";
import { RmqServer } from "./server.ts";

const serializer = new RmqSerializer();

function makeCtx(_: Type, instance: unknown): InjectorContext {
  return {
    runInRequestScopeAsync: (_id: string, fn: () => Promise<unknown>) => fn(),
    getHostModuleRef: () => ({
      get: (_type: Type, _opts: unknown) => Promise.resolve(instance),
    }),
    clearContext: () => {},
  } as unknown as InjectorContext;
}

function makeBody(data: unknown): Buffer {
  return Buffer.from(serializer.serialize({ data }));
}

interface MockChannel {
  assertQueue: (name: string, opts: unknown) => Promise<{ queue: string }>;
  assertExchange: (name: string, type: string, opts: unknown) => Promise<void>;
  bindQueue: (q: string, ex: string, key: string) => Promise<void>;
  prefetch: (count: number, isGlobal?: boolean) => Promise<void>;
  consume: (
    queue: string,
    fn: (msg: unknown) => void,
    opts: unknown,
  ) => Promise<void>;
  sendToQueue: (q: string, buf: Buffer, opts: unknown) => boolean;
  ack: (msg: unknown) => void;
  nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
  close: () => Promise<void>;
  _msgHandler?: (msg: unknown) => void;
}

interface MockConnection {
  createChannel: () => Promise<MockChannel>;
  close: () => Promise<void>;
  on: (event: string, fn: (...args: unknown[]) => void) => void;
  _handlers: Record<string, (...args: unknown[]) => void>;
}

function makeChannel(): MockChannel {
  const ch: MockChannel = {
    assertQueue: (name, _opts) => Promise.resolve({ queue: name || "denorid" }),
    assertExchange: async () => {},
    bindQueue: async () => {},
    prefetch: async () => {},
    consume: (_queue, fn, _opts) => {
      ch._msgHandler = fn;

      return Promise.resolve();
    },
    sendToQueue: () => true,
    ack: () => {},
    nack: () => {},
    close: () => Promise.resolve(),
  };
  return ch;
}

function makeConnection(ch: MockChannel): MockConnection {
  const conn: MockConnection = {
    createChannel: () => Promise.resolve(ch),
    close: () => Promise.resolve(),
    on: (event, fn) => {
      conn._handlers[event] = fn;
    },
    _handlers: {},
  };
  return conn;
}

function makeMsg(
  pattern: string,
  data: unknown,
  opts: {
    correlationId?: string;
    replyTo?: string;
  } = {},
) {
  return {
    properties: {
      headers: { pattern },
      correlationId: opts.correlationId,
      replyTo: opts.replyTo,
    },
    content: makeBody(data),
  };
}

async function runServer(
  server: RmqServer,
  conn: MockConnection,
): Promise<() => void> {
  server.listen().catch(() => {}); // starts in background
  await new Promise<void>((r) => setTimeout(r, 10));
  return () => {
    conn._handlers["close"]?.();
  };
}

describe(RmqServer.name, () => {
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
    it("closes channel and connection", async () => {
      let channelClosed = false;
      let connClosed = false;
      const ch = makeChannel();
      ch.close = () => {
        channelClosed = true;

        return Promise.resolve();
      };
      const conn = makeConnection(ch);
      conn.close = () => {
        connClosed = true;

        return Promise.resolve();
      };
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      await runServer(server, conn);
      await server.close();

      assertEquals(channelClosed, true);
      assertEquals(connClosed, true);
    });

    it("is safe to call when not connected", async () => {
      const server = new RmqServer({});
      await server.close();
    });

    it("resolves listen() when connection fires close event during close()", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      // Simulate amqplib: conn.close() triggers the "close" event on the connection
      conn.close = () => {
        conn._handlers["close"]?.();

        return Promise.resolve();
      };
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 10));

      await server.close(); // closing=true, conn.close() fires "close" → listen() resolves
      await listenPromise; // should resolve (not reject)
    });

    it("swallows channel.close() error in server.close()", async () => {
      const ch = makeChannel();
      ch.close = () => Promise.reject(new Error("channel gone"));
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const stop = await runServer(server, conn);
      stop();
      await new Promise<void>((r) => setTimeout(r, 5));
      await server.close(); // must not throw despite ch.close() throwing
    });

    it("swallows connection.close() error in server.close()", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      conn.close = () => Promise.reject(new Error("conn gone"));
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const stop = await runServer(server, conn);
      stop();
      await new Promise<void>((r) => setTimeout(r, 5));
      await server.close(); // must not throw despite conn.close() throwing
    });
  });

  describe("listen() - message handling", () => {
    it("dispatches a message and sends reply when correlationId+replyTo present", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("greet")
        greet(data: unknown): string {
          return `hello ${data}`;
        }
      }

      let sentReply: unknown;
      const ch = makeChannel();
      ch.sendToQueue = (_q, buf, _opts) => {
        sentReply = JSON.parse(buf.toString());
        return true;
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      server.registerHandlers(
        [Ctrl as unknown as Type],
        makeCtx(Ctrl as unknown as Type, new Ctrl()),
      );
      const stop = await runServer(server, conn);

      const msg = makeMsg(serializePattern("greet"), "world", {
        correlationId: "cid-1",
        replyTo: "reply-queue",
      });
      await ch._msgHandler?.(msg);
      await new Promise<void>((r) => setTimeout(r, 10));

      assertEquals(sentReply, "hello world");
      stop();
      await server.close();
    });

    it("does not send reply for fire-and-forget events", async () => {
      @MessageController()
      class EvCtrl {
        @EventPattern("user.created")
        onCreate(): void {}
      }

      let replySent = false;
      const ch = makeChannel();
      ch.sendToQueue = () => {
        replySent = true;
        return true;
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      server.registerHandlers(
        [EvCtrl as unknown as Type],
        makeCtx(EvCtrl as unknown as Type, new EvCtrl()),
      );
      const stop = await runServer(server, conn);

      const msg = makeMsg(serializePattern("user.created"), null);
      await ch._msgHandler?.(msg);
      await new Promise<void>((r) => setTimeout(r, 10));

      assertEquals(replySent, false);
      stop();
      await server.close();
    });

    it("acks message when noAck is false (default)", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("ok")
        handle(): string {
          return "ok";
        }
      }

      let acked: unknown = null;
      const ch = makeChannel();
      ch.ack = (msg) => {
        acked = msg;
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ noAck: false });
      server.registerHandlers(
        [Ctrl as unknown as Type],
        makeCtx(Ctrl as unknown as Type, new Ctrl()),
      );
      const stop = await runServer(server, conn);

      const msg = makeMsg(serializePattern("ok"), null);
      await ch._msgHandler?.(msg);
      await new Promise<void>((r) => setTimeout(r, 10));

      assertEquals(acked !== null, true);
      stop();
      await server.close();
    });

    it("does not ack when noAck is true", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("ok")
        handle(): string {
          return "ok";
        }
      }

      let ackCalled = false;
      const ch = makeChannel();
      ch.ack = () => {
        ackCalled = true;
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ noAck: true });
      server.registerHandlers(
        [Ctrl as unknown as Type],
        makeCtx(Ctrl as unknown as Type, new Ctrl()),
      );
      const stop = await runServer(server, conn);

      const msg = makeMsg(serializePattern("ok"), null);
      await ch._msgHandler?.(msg);
      await new Promise<void>((r) => setTimeout(r, 10));

      assertEquals(ackCalled, false);
      stop();
      await server.close();
    });

    it("sends error reply and nacks when handler throws", async () => {
      @MessageController()
      class ErrCtrl {
        @MessagePattern("fail")
        fail(): never {
          throw new Error("test error");
        }
      }

      let errReply: unknown;
      let nackCalled = false;
      const ch = makeChannel();
      ch.sendToQueue = (_q, buf, _opts) => {
        errReply = JSON.parse(buf.toString());
        return true;
      };
      ch.nack = () => {
        nackCalled = true;
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ noAck: false });
      server.registerHandlers(
        [ErrCtrl as unknown as Type],
        makeCtx(ErrCtrl as unknown as Type, new ErrCtrl()),
      );
      const stop = await runServer(server, conn);

      const msg = makeMsg(serializePattern("fail"), null, {
        correlationId: "cid-err",
        replyTo: "reply-q",
      });
      await ch._msgHandler?.(msg);
      await new Promise<void>((r) => setTimeout(r, 10));

      assertEquals((errReply as { err: string }).err, "test error");
      assertEquals(nackCalled, true);
      stop();
      await server.close();
    });

    it("sends non-Error throw as string in err field", async () => {
      @MessageController()
      class ErrCtrl {
        @MessagePattern("throw-str")
        fail(): never {
          throw "string error";
        }
      }

      let errReply: unknown;
      const ch = makeChannel();
      ch.sendToQueue = (_q, buf, _opts) => {
        errReply = JSON.parse(buf.toString());
        return true;
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      server.registerHandlers(
        [ErrCtrl as unknown as Type],
        makeCtx(ErrCtrl as unknown as Type, new ErrCtrl()),
      );
      const stop = await runServer(server, conn);

      const msg = makeMsg(serializePattern("throw-str"), null, {
        correlationId: "cid",
        replyTo: "reply-q",
      });
      await ch._msgHandler?.(msg);
      await new Promise<void>((r) => setTimeout(r, 10));

      assertEquals((errReply as { err: string }).err, "string error");
      stop();
      await server.close();
    });

    it("logs error when handleMessage throws before the try/catch (invalid body)", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const errorSpy = spy(
        (server as unknown as Record<
          string,
          { error: (...a: unknown[]) => void }
        >)["logger"],
        "error",
      );
      const stop = await runServer(server, conn);

      // Invalid JSON body causes deserializer to throw before the handler try/catch
      const badMsg = {
        properties: {
          headers: { pattern: "any" },
          correlationId: undefined,
          replyTo: undefined,
        },
        content: Buffer.from("not-valid-json"),
      };
      ch._msgHandler?.(badMsg);
      await new Promise<void>((r) => setTimeout(r, 10));

      assertEquals(errorSpy.calls.length, 1);
      stop();
      await server.close();
    });

    it("falls back to empty string pattern when headers has no pattern key", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ noAck: true });
      const stop = await runServer(server, conn);

      const msg = {
        properties: {
          headers: {},
          correlationId: undefined,
          replyTo: undefined,
        },
        content: makeBody(null),
      };
      await ch._msgHandler?.(msg);
      await new Promise<void>((r) => setTimeout(r, 10));

      stop();
      await server.close();
    });

    it("ignores null messages from consumer", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const stop = await runServer(server, conn);

      // null message should be silently ignored
      await ch._msgHandler?.(null);
      await new Promise<void>((r) => setTimeout(r, 5));

      stop();
      await server.close();
    });
  });

  describe("listen() - configuration branches", () => {
    it("passes explicit queueOptions.durable to assertQueue", async () => {
      let capturedOpts: unknown;
      const ch = makeChannel();
      ch.assertQueue = (_name, opts) => {
        capturedOpts = opts;
        return Promise.resolve({ queue: "q" });
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ queueOptions: { durable: false } });
      const stop = await runServer(server, conn);

      assertEquals((capturedOpts as { durable: boolean }).durable, false);
      stop();
      await server.close();
    });

    it("skips assertQueue when noAssert is true", async () => {
      let assertQueueCalled = false;
      const ch = makeChannel();
      ch.assertQueue = () => {
        assertQueueCalled = true;
        return Promise.resolve({ queue: "q" });
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ noAssert: true, queue: "my-q" });
      const stop = await runServer(server, conn);

      assertEquals(assertQueueCalled, false);
      stop();
      await server.close();
    });

    it("calls prefetch when prefetchCount is set", async () => {
      let prefetchCount = 0;
      const ch = makeChannel();
      ch.prefetch = (count, _global) => {
        prefetchCount = count;

        return Promise.resolve();
      };

      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ prefetchCount: 5 });
      const stop = await runServer(server, conn);

      assertEquals(prefetchCount, 5);
      stop();
      await server.close();
    });

    it("asserts exchange and binds queue when exchange is set", async () => {
      let exchangeAsserted = false;
      let queueBound = false;
      const ch = makeChannel();
      ch.assertExchange = () => {
        exchangeAsserted = true;

        return Promise.resolve();
      };
      ch.bindQueue = () => {
        queueBound = true;

        return Promise.resolve();
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ exchange: "my-ex", routingKey: "rk" });
      const stop = await runServer(server, conn);

      assertEquals(exchangeAsserted, true);
      assertEquals(queueBound, true);
      stop();
      await server.close();
    });

    it("passes exchangeOptions.arguments to assertExchange", async () => {
      let capturedOpts: unknown;
      const ch = makeChannel();
      ch.assertExchange = (_name, _type, opts) => {
        capturedOpts = opts;

        return Promise.resolve();
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({
        exchange: "test-ex",
        exchangeOptions: { arguments: { "x-ttl": 1000 } },
      });
      const stop = await runServer(server, conn);

      assertEquals(
        (capturedOpts as { arguments: unknown }).arguments,
        { "x-ttl": 1000 },
      );
      stop();
      await server.close();
    });

    it("skips assertExchange when noAssert is true but still binds", async () => {
      let exchangeAsserted = false;
      let queueBound = false;
      const ch = makeChannel();
      ch.assertExchange = () => {
        exchangeAsserted = true;

        return Promise.resolve();
      };
      ch.bindQueue = () => {
        queueBound = true;

        return Promise.resolve();
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ exchange: "ex", noAssert: true });
      const stop = await runServer(server, conn);

      assertEquals(exchangeAsserted, false);
      assertEquals(queueBound, true);
      stop();
      await server.close();
    });

    it("rejects listen() when connection closes unexpectedly", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 10));

      conn._handlers["close"]?.(); // unexpected close while closing=false

      await listenPromise.catch(() => {}); // should reject

      await server.close();
    });

    it("rejects listen() on connection error event", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const listenPromise = server.listen();
      await new Promise<void>((r) => setTimeout(r, 10));

      conn._handlers["error"]?.(new Error("connection error"));
      await listenPromise.catch(() => {});
      await server.close();
    });
  });
});
