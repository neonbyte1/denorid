import {
  EventPattern,
  MessageController,
  MessagePattern,
  serializePattern,
} from "@denorid/core/microservices";
import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import amqplib, { type Options } from "amqplib";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { mockStdWrite, type RestoreFn } from "../_test_utils.ts";
import { RmqSerializer } from "./serializer.ts";
import { RmqServer } from "./server.ts";

interface Reply {
  queue: string;
  body: unknown;
  options: Options.Publish;
}

class FakeChannel extends EventEmitter {
  public readonly replies: Reply[] = [];
  public readonly acked: unknown[] = [];
  public readonly nacked: unknown[][] = [];
  public consumeOptions?: Options.Consume;
  public messageHandler?: (msg: unknown) => void;

  public constructor(private readonly log: string[]) {
    super();
  }

  public assertQueue = (
    name: string,
    _opts: unknown,
  ): Promise<{ queue: string }> => Promise.resolve({ queue: name });

  public assertExchange = (
    _name: string,
    _type: string,
    _opts: unknown,
  ): Promise<void> => Promise.resolve();

  public bindQueue = (_q: string, _ex: string, _key: string): Promise<void> =>
    Promise.resolve();

  public prefetch = (_count: number, _global?: boolean): Promise<void> =>
    Promise.resolve();

  public consume = (
    _queue: string,
    fn: (msg: unknown) => void,
    opts: Options.Consume,
  ): Promise<{ consumerTag: string }> => {
    this.messageHandler = fn;
    this.consumeOptions = opts;

    return Promise.resolve({ consumerTag: opts.consumerTag ?? "ctag" });
  };

  public cancel = (consumerTag: string): Promise<void> => {
    this.log.push(`cancel:${consumerTag}`);

    return Promise.resolve();
  };

  public sendToQueue = (
    queue: string,
    content: Buffer,
    options: Options.Publish,
  ): boolean => {
    this.log.push("reply");
    this.replies.push({
      queue,
      body: JSON.parse(content.toString()),
      options,
    });

    return true;
  };

  public ack = (msg: unknown): void => {
    this.log.push("ack");
    this.acked.push(msg);
  };

  public nack = (msg: unknown, allUpTo: boolean, requeue: boolean): void => {
    this.log.push("nack");
    this.nacked.push([msg, allUpTo, requeue]);
  };

  public close = (): Promise<void> => {
    this.log.push("channel.close");
    this.emit("close");

    return Promise.resolve();
  };
}

class FakeConnection extends EventEmitter {
  public readonly log: string[] = [];
  public readonly channel: FakeChannel = new FakeChannel(this.log);
  public closeCalls = 0;

  public createChannel = (): Promise<FakeChannel> =>
    Promise.resolve(this.channel);

  public close = (): Promise<void> => {
    this.closeCalls++;
    this.log.push("connection.close");
    this.emit("close");

    return Promise.resolve();
  };
}

/** Private members some tests inspect. */
interface ServerInternals {
  logger: { error: (...args: unknown[]) => void };
}

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

function makeMsg(
  pattern: string,
  data: unknown,
  opts: { correlationId?: string; replyTo?: string } = {},
) {
  return {
    properties: {
      headers: { pattern },
      correlationId: opts.correlationId,
      replyTo: opts.replyTo,
    },
    content: Buffer.from(serializer.serialize({ data })),
  };
}

/** Lets every pending fake (microtask-only) operation settle. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Answers each `amqplib.connect` call with the next of `results`: a
 * connection (or a promise of one) to resolve with, or an error to reject with.
 */
function sequence(
  ...results: (FakeConnection | Promise<FakeConnection> | Error)[]
): () => Promise<never> {
  let calls = 0;

  return () => {
    const result = results[calls++];

    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result as never);
  };
}

/** Makes `channel.consume` wait for the returned gate before it starts. */
function holdConsume(channel: FakeChannel): PromiseWithResolvers<void> {
  const gate = Promise.withResolvers<void>();
  const { consume } = channel;

  channel.consume = (queue, fn, opts) =>
    gate.promise.then(() => consume(queue, fn, opts));

  return gate;
}

function serve(
  server: RmqServer,
  controller: new () => object,
): void {
  server.registerHandlers(
    [controller as unknown as Type],
    makeCtx(controller as unknown as Type, new controller()),
  );
}

describe(RmqServer.name, () => {
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

  describe("close()", () => {
    it("cancels the consumer, then closes channel and connection", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      await server.listen();
      await server.close();

      assertEquals(conn.log, [
        "cancel:ctag",
        "channel.close",
        "connection.close",
      ]);
    });

    it("lets an in-flight handler reply and ack before closing the channel", async () => {
      const gate = Promise.withResolvers<string>();

      @MessageController()
      class SlowCtrl {
        @MessagePattern("slow")
        slow(): Promise<string> {
          return gate.promise;
        }
      }

      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ consumerTag: "my-tag" });
      serve(server, SlowCtrl);
      await server.listen();
      conn.channel.messageHandler!(makeMsg("slow", null, {
        correlationId: "cid",
        replyTo: "reply-q",
      }));
      await flush();

      const closing = server.close();
      await flush();
      assertEquals(conn.log, ["cancel:my-tag"]);

      gate.resolve("done");
      await closing;

      assertEquals(conn.log, [
        "cancel:my-tag",
        "reply",
        "ack",
        "channel.close",
        "connection.close",
      ]);
      assertEquals(conn.channel.replies[0].body, "done");
    });

    it("still closes channel and connection when cancelling the consumer fails", async () => {
      const conn = new FakeConnection();
      conn.channel.cancel = () => Promise.reject(new Error("cancel failed"));
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      await server.listen();
      await server.close();

      assertEquals(conn.log, ["channel.close", "connection.close"]);
    });

    it("is safe to call before listen() and twice", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      await server.close();
      await server.listen();
      await server.close();
      await server.close();

      assertEquals(conn.log, [
        "cancel:ctag",
        "channel.close",
        "connection.close",
      ]);
    });

    it("swallows channel.close() and connection.close() errors", async () => {
      const conn = new FakeConnection();
      conn.channel.close = () => Promise.reject(new Error("channel gone"));
      conn.close = () => {
        throw new Error("conn gone");
      };
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      await server.listen();
      await server.close();
    });

    it("stops a pending listen(), which resolves; the connection it gets later is closed unused", async () => {
      const connecting = Promise.withResolvers<FakeConnection>();
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", sequence(connecting.promise));

      const server = new RmqServer({});
      const listening = server.listen();
      const closing = server.close();

      connecting.resolve(conn);
      await closing;

      assertEquals(conn.log, ["connection.close"]);
      assertEquals(conn.channel.messageHandler, undefined);
      await listening;
    });

    it("stops the connection retries of a pending listen()", async () => {
      using time = new FakeTime();
      using connect = stub(
        amqplib,
        "connect",
        () => Promise.reject(new Error("refused")),
      );

      const server = new RmqServer({
        maxConnectionAttempts: 5,
        retryDelay: 1000,
      });
      const listening = server.listen();

      await time.tickAsync(500);
      await server.close();
      await listening;
      await time.tickAsync(5000);

      assertEquals(connect.calls.length, 1);
    });

    it("shuts down a session whose consumer started while it waited", async () => {
      const conn = new FakeConnection();
      const consuming = holdConsume(conn.channel);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const listening = server.listen();
      await flush();
      const closing = server.close();

      consuming.resolve();
      await listening;
      await closing;

      assertEquals(conn.log, [
        "cancel:ctag",
        "channel.close",
        "connection.close",
      ]);
    });
  });

  describe("listen() - startup", () => {
    it("resolves once the consumer runs", async () => {
      const conn = new FakeConnection();
      const consuming = holdConsume(conn.channel);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));
      let listening = false;

      const server = new RmqServer({});
      const started = server.listen().then(() => {
        listening = true;
      });
      await flush();
      assertEquals(listening, false);

      consuming.resolve();
      await started;

      assertEquals(conn.channel.messageHandler !== undefined, true);
      await server.close();
    });

    it("retries the connection maxConnectionAttempts times, retryDelay ms apart", async () => {
      const conn = new FakeConnection();
      using connect = stub(
        amqplib,
        "connect",
        sequence(new Error("refused"), conn),
      );

      const server = new RmqServer({ maxConnectionAttempts: 2, retryDelay: 0 });
      await server.listen();

      assertEquals(connect.calls.length, 2);
      assertEquals(conn.channel.messageHandler !== undefined, true);
      await server.close();
    });

    it("rejects when the broker is unreachable", async () => {
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.reject(new Error("refused")),
      );

      await assertRejects(() => new RmqServer({}).listen(), Error, "refused");
    });

    it("logs connection and channel errors instead of crashing, also during setup", async () => {
      const gate = Promise.withResolvers<void>();
      const conn = new FakeConnection();
      const { assertQueue } = conn.channel;
      conn.channel.assertQueue = (name, opts) =>
        gate.promise.then(() => assertQueue(name, opts));
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const errorSpy = spy(
        (server as unknown as ServerInternals).logger,
        "error",
      );
      const listening = server.listen();
      await flush();

      conn.emit("error", new Error("setup conn error"));
      conn.channel.emit("error", new Error("setup channel error"));
      gate.resolve();
      await listening;
      conn.emit("error", new Error("conn error"));
      conn.channel.emit("error", new Error("channel error"));

      assertEquals(errorSpy.calls.length, 4);
      await server.close();
    });

    it("closes the connection and rejects when the topology setup fails", async () => {
      const conn = new FakeConnection();
      const failure = new Error("PRECONDITION_FAILED");
      conn.channel.assertQueue = () => Promise.reject(failure);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const err = await assertRejects(() => new RmqServer({}).listen());

      assertStrictEquals(err, failure);
      assertEquals(conn.closeCalls, 1);
    });

    it("rejects with the setup error and does not reconnect when the connection drops during setup", async () => {
      const gate = Promise.withResolvers<{ queue: string }>();
      const conn = new FakeConnection();
      conn.channel.assertQueue = () => gate.promise;
      using connect = stub(
        amqplib,
        "connect",
        () => Promise.resolve(conn as never),
      );

      const server = new RmqServer({});
      const listening = server.listen();
      await flush();
      conn.channel.emit("close");
      conn.emit("close", new Error("socket reset"));
      gate.reject(new Error("Channel closed"));

      await assertRejects(() => listening, Error, "Channel closed");
      await flush();
      assertEquals(connect.calls.length, 1);
      assertEquals(conn.closeCalls, 1);
    });
  });

  describe("listen() - reconnecting", () => {
    it("logs a dropped connection with its cause and consumes again on a new one", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("greet")
        greet(data: unknown): string {
          return `hello ${data}`;
        }
      }

      const first = new FakeConnection();
      const second = new FakeConnection();
      using connect = stub(amqplib, "connect", sequence(first, second));
      const cause = new Error("socket reset");

      const server = new RmqServer({});
      const errorSpy = spy(
        (server as unknown as ServerInternals).logger,
        "error",
      );
      serve(server, Ctrl);
      await server.listen();

      // amqplib closes the channels of a dropped connection first.
      first.channel.emit("close");
      first.emit("close", cause);
      await flush();

      assertEquals(connect.calls.length, 2);
      assertEquals(errorSpy.calls.map((call) => call.args), [
        ["RMQ connection closed unexpectedly, reconnecting", cause],
      ]);
      assertEquals(first.closeCalls, 1);

      second.channel.messageHandler!(makeMsg("greet", "again", {
        correlationId: "cid",
        replyTo: "reply-q",
      }));
      await flush();
      await server.close();

      assertEquals(second.channel.replies[0].body, "hello again");
      assertEquals(second.log, [
        "reply",
        "ack",
        "cancel:ctag",
        "channel.close",
        "connection.close",
      ]);
    });

    it("closes the old connection and reconnects once when only the consumer channel closed", async () => {
      const first = new FakeConnection();
      const second = new FakeConnection();
      using connect = stub(amqplib, "connect", sequence(first, second));

      const server = new RmqServer({});
      const errorSpy = spy(
        (server as unknown as ServerInternals).logger,
        "error",
      );
      await server.listen();

      first.channel.emit("close");
      await flush();

      assertEquals(first.log, ["connection.close"]);
      assertEquals(connect.calls.length, 2);
      assertEquals(errorSpy.calls.map((call) => call.args[0]), [
        "RMQ channel closed unexpectedly, reconnecting",
      ]);
      assertEquals(second.channel.messageHandler !== undefined, true);
      await server.close();
    });

    it("retries every 1000 ms by default, logging each failed attempt, until it consumes again", async () => {
      using time = new FakeTime();
      const first = new FakeConnection();
      const broken = new FakeConnection();
      const second = new FakeConnection();
      const refused = new Error("refused");
      const failure = new Error("PRECONDITION_FAILED");
      broken.channel.assertQueue = () => Promise.reject(failure);
      using connect = stub(
        amqplib,
        "connect",
        sequence(first, refused, broken, second),
      );

      const server = new RmqServer({ maxConnectionAttempts: 3 });
      const errorSpy = spy(
        (server as unknown as ServerInternals).logger,
        "error",
      );
      await server.listen();

      first.emit("close");
      await time.runMicrotasks();
      assertEquals(connect.calls.length, 2);

      await time.tickAsync(999);
      assertEquals(connect.calls.length, 2);
      await time.tickAsync(1);
      await time.runMicrotasks();
      assertEquals(connect.calls.length, 3);
      assertEquals(broken.closeCalls, 1);

      await time.tickAsync(1000);
      await time.runMicrotasks();
      assertEquals(connect.calls.length, 4);
      assertEquals(errorSpy.calls.map((call) => call.args), [
        ["RMQ connection closed unexpectedly, reconnecting", undefined],
        ["RMQ reconnect failed, retrying in 1000 ms", refused],
        ["RMQ reconnect failed, retrying in 1000 ms", failure],
      ]);
      assertEquals(second.channel.messageHandler !== undefined, true);
      await server.close();
    });

    it("does not reconnect on the close events close() causes", async () => {
      const conn = new FakeConnection();
      using connect = stub(
        amqplib,
        "connect",
        () => Promise.resolve(conn as never),
      );

      const server = new RmqServer({});
      const errorSpy = spy(
        (server as unknown as ServerInternals).logger,
        "error",
      );
      await server.listen();
      // The fakes emit `close` when closed, as amqplib does.
      await server.close();
      await flush();

      assertEquals(connect.calls.length, 1);
      assertEquals(errorSpy.calls.length, 0);
    });

    it("does not reconnect after a drop that happens as close() starts", async () => {
      const conn = new FakeConnection();
      using connect = stub(
        amqplib,
        "connect",
        () => Promise.resolve(conn as never),
      );

      const server = new RmqServer({});
      const errorSpy = spy(
        (server as unknown as ServerInternals).logger,
        "error",
      );
      await server.listen();
      conn.channel.emit("close");
      await server.close();
      await flush();

      assertEquals(connect.calls.length, 1);
      assertEquals(conn.log, ["connection.close"]);
      assertEquals(errorSpy.calls.length, 0);
    });

    it("close() stops a reconnect waiting for its next attempt", async () => {
      using time = new FakeTime();
      const first = new FakeConnection();
      using connect = stub(
        amqplib,
        "connect",
        sequence(first, new Error("refused")),
      );

      const server = new RmqServer({ retryDelay: 60_000 });
      await server.listen();
      first.emit("close");
      await time.runMicrotasks();
      assertEquals(connect.calls.length, 2);

      await server.close();
      await time.tickAsync(120_000);

      assertEquals(connect.calls.length, 2);
    });

    it("close() waits for a pending reconnect attempt and closes the connection it gets", async () => {
      const first = new FakeConnection();
      const second = new FakeConnection();
      const connecting = Promise.withResolvers<FakeConnection>();
      using connect = stub(
        amqplib,
        "connect",
        sequence(first, connecting.promise),
      );

      const server = new RmqServer({});
      await server.listen();
      first.emit("close");
      await flush();

      const closing = server.close();

      connecting.resolve(second);
      await closing;

      assertEquals(connect.calls.length, 2);
      assertEquals(second.log, ["connection.close"]);
      assertEquals(second.channel.messageHandler, undefined);
    });
  });

  describe("listen() - message handling", () => {
    it("dispatches a message and replies when correlationId+replyTo are present", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("greet")
        greet(data: unknown): string {
          return `hello ${data}`;
        }
      }

      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      serve(server, Ctrl);
      await server.listen();
      conn.channel.messageHandler!(makeMsg(serializePattern("greet"), "world", {
        correlationId: "cid-1",
        replyTo: "reply-queue",
      }));
      await flush();

      assertEquals(conn.channel.replies, [{
        queue: "reply-queue",
        body: "hello world",
        options: { correlationId: "cid-1", contentType: "application/json" },
      }]);
      assertEquals(conn.channel.acked.length, 1);
      await server.close();
    });

    it("replies null and acks when a message handler returns nothing", async () => {
      @MessageController()
      class VoidCtrl {
        @MessagePattern("void")
        handle(): void {}
      }

      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      serve(server, VoidCtrl);
      await server.listen();
      conn.channel.messageHandler!(makeMsg("void", null, {
        correlationId: "cid",
        replyTo: "reply-q",
      }));
      await flush();

      assertEquals(conn.channel.replies[0].body, null);
      assertEquals(conn.log.slice(-2), ["reply", "ack"]);
      await server.close();
    });

    it("does not reply to fire-and-forget events", async () => {
      @MessageController()
      class EvCtrl {
        @EventPattern("user.created")
        onCreate(): void {}
      }

      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      serve(server, EvCtrl);
      await server.listen();
      conn.channel.messageHandler!(makeMsg("user.created", null));
      await flush();

      assertEquals(conn.channel.replies.length, 0);
      assertEquals(conn.channel.acked.length, 1);
      await server.close();
    });

    it("neither acks nor nacks when noAck is true", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("ok")
        ok(): string {
          return "ok";
        }

        @MessagePattern("fail")
        fail(): never {
          throw new Error("fail");
        }
      }

      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ noAck: true });
      serve(server, Ctrl);
      await server.listen();
      conn.channel.messageHandler!(makeMsg("ok", null));
      conn.channel.messageHandler!(makeMsg("fail", null));
      conn.channel.messageHandler!({
        properties: { headers: { pattern: "ok" } },
        content: Buffer.from("not-json"),
      });
      await flush();

      assertEquals(conn.channel.consumeOptions?.noAck, true);
      assertEquals(conn.channel.acked.length, 0);
      assertEquals(conn.channel.nacked.length, 0);
      await server.close();
    });

    it("replies with the error and nacks without requeue when the handler throws", async () => {
      @MessageController()
      class ErrCtrl {
        @MessagePattern("fail")
        fail(): never {
          throw new Error("test error");
        }

        @MessagePattern("throw-str")
        throwString(): never {
          throw "string error";
        }
      }

      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      serve(server, ErrCtrl);
      await server.listen();
      const msg = makeMsg("fail", null, { correlationId: "c1", replyTo: "r" });
      conn.channel.messageHandler!(msg);
      conn.channel.messageHandler!(
        makeMsg("throw-str", null, { correlationId: "c2", replyTo: "r" }),
      );
      await flush();

      assertEquals(conn.channel.replies.map((reply) => reply.body), [
        { err: "test error" },
        { err: "string error" },
      ]);
      assertEquals(conn.channel.replies[0].options.correlationId, "c1");
      assertEquals(conn.channel.nacked[0], [msg, false, false]);
      assertEquals(conn.channel.acked.length, 0);
      await server.close();
    });

    for (const body of ["not-valid-json", "null"]) {
      it(`logs, replies with an error and nacks a malformed body (${body})`, async () => {
        const conn = new FakeConnection();
        using _s = stub(
          amqplib,
          "connect",
          () => Promise.resolve(conn as never),
        );

        const server = new RmqServer({});
        const errorSpy = spy(
          (server as unknown as ServerInternals).logger,
          "error",
        );
        await server.listen();
        const msg = {
          properties: {
            headers: { pattern: "any" },
            correlationId: "cid",
            replyTo: "reply-q",
          },
          content: Buffer.from(body),
        };
        conn.channel.messageHandler!(msg);
        await flush();

        assertEquals(errorSpy.calls.length, 1);
        const replied = conn.channel.replies[0].body as { err: string };
        assertEquals(
          replied.err.startsWith("Failed to deserialize message: "),
          true,
        );
        assertEquals(conn.channel.nacked, [[msg, false, false]]);
        await server.close();
      });
    }

    it("acks and replies with an error when the response cannot be serialized", async () => {
      @MessageController()
      class BigCtrl {
        @MessagePattern("big")
        big(): bigint {
          return 10n;
        }
      }

      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const errorSpy = spy(
        (server as unknown as ServerInternals).logger,
        "error",
      );
      serve(server, BigCtrl);
      await server.listen();
      conn.channel.messageHandler!(makeMsg("big", null, {
        correlationId: "cid",
        replyTo: "reply-q",
      }));
      await flush();

      assertEquals(errorSpy.calls.length, 1);
      assertEquals(conn.channel.replies[0].body, {
        err:
          "Failed to serialize response: Do not know how to serialize a BigInt",
      });
      assertEquals(conn.channel.acked.length, 1);
      assertEquals(conn.channel.nacked.length, 0);
      await server.close();
    });

    it("logs failed replies and acks instead of throwing", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("ok")
        ok(): string {
          return "ok";
        }
      }

      const conn = new FakeConnection();
      conn.channel.sendToQueue = () => {
        throw new Error("Channel closed");
      };
      conn.channel.ack = () => {
        throw new Error("Channel closed");
      };
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      const errorSpy = spy(
        (server as unknown as ServerInternals).logger,
        "error",
      );
      serve(server, Ctrl);
      await server.listen();
      conn.channel.messageHandler!(makeMsg("ok", null, {
        correlationId: "cid",
        replyTo: "reply-q",
      }));
      await flush();

      assertEquals(errorSpy.calls.length, 2);
      await server.close();
    });

    it("falls back to an empty pattern when the message has no pattern header", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("")
        empty(): string {
          return "empty";
        }
      }

      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      serve(server, Ctrl);
      await server.listen();
      for (const headers of [{}, undefined]) {
        conn.channel.messageHandler!({
          properties: { headers, correlationId: "cid", replyTo: "reply-q" },
          content: Buffer.from(serializer.serialize({ data: null })),
        });
      }
      await flush();

      assertEquals(conn.channel.replies.map((reply) => reply.body), [
        "empty",
        "empty",
      ]);
      await server.close();
    });

    it("ignores null messages from the consumer", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({});
      await server.listen();
      conn.channel.messageHandler!(null);
      await flush();

      assertEquals(conn.log, []);
      await server.close();
    });
  });

  describe("listen() - configuration branches", () => {
    it("asserts a durable queue by default and honours queueOptions.durable", async () => {
      for (
        const [queueOptions, durable] of [[undefined, true], [{
          durable: false,
        }, false]] as const
      ) {
        const conn = new FakeConnection();
        const assertQueue = spy(conn.channel, "assertQueue");
        using _s = stub(
          amqplib,
          "connect",
          () => Promise.resolve(conn as never),
        );

        const server = new RmqServer({ queueOptions });
        await server.listen();

        assertEquals(assertQueue.calls[0].args[0], "denorid");
        assertEquals(
          (assertQueue.calls[0].args[1] as { durable: boolean }).durable,
          durable,
        );
        await server.close();
      }
    });

    it("skips assertQueue when noAssert is true", async () => {
      const conn = new FakeConnection();
      const assertQueue = spy(conn.channel, "assertQueue");
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ noAssert: true, queue: "my-q" });
      await server.listen();

      assertEquals(assertQueue.calls.length, 0);
      await server.close();
    });

    it("calls prefetch when prefetchCount is set", async () => {
      const conn = new FakeConnection();
      const prefetch = spy(conn.channel, "prefetch");
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({
        prefetchCount: 5,
        isGlobalPrefetchCount: true,
      });
      await server.listen();

      assertEquals(prefetch.calls[0].args, [5, true]);
      await server.close();
    });

    it("asserts the exchange and binds the queue when exchange is set", async () => {
      const conn = new FakeConnection();
      const assertExchange = spy(conn.channel, "assertExchange");
      const bindQueue = spy(conn.channel, "bindQueue");
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({
        exchange: "my-ex",
        routingKey: "rk",
        exchangeType: "topic",
        exchangeOptions: { durable: false, arguments: { "x-ttl": 1000 } },
      });
      await server.listen();

      assertEquals(assertExchange.calls[0].args.slice(0, 2), [
        "my-ex",
        "topic",
      ]);
      assertEquals(
        (assertExchange.calls[0].args[2] as Record<string, unknown>).arguments,
        { "x-ttl": 1000 },
      );
      assertEquals(bindQueue.calls[0].args, ["denorid", "my-ex", "rk"]);
      await server.close();
    });

    it("uses direct durable exchange defaults and the empty routing key", async () => {
      const conn = new FakeConnection();
      const assertExchange = spy(conn.channel, "assertExchange");
      const bindQueue = spy(conn.channel, "bindQueue");
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ exchange: "ex" });
      await server.listen();

      assertEquals(assertExchange.calls[0].args[1], "direct");
      assertEquals(
        (assertExchange.calls[0].args[2] as { durable: boolean }).durable,
        true,
      );
      assertEquals(bindQueue.calls[0].args[2], "");
      await server.close();
    });

    it("skips assertExchange when noAssert is true but still binds", async () => {
      const conn = new FakeConnection();
      const assertExchange = spy(conn.channel, "assertExchange");
      const bindQueue = spy(conn.channel, "bindQueue");
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const server = new RmqServer({ exchange: "ex", noAssert: true });
      await server.listen();

      assertEquals(assertExchange.calls.length, 0);
      assertEquals(bindQueue.calls.length, 1);
      await server.close();
    });
  });
});
