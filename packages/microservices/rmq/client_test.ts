import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import amqplib, { type Options } from "amqplib";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { mockStdWrite, type RestoreFn } from "../_test_utils.ts";
import { RmqClient } from "./client.ts";
import { RmqSerializer } from "./serializer.ts";

interface Published {
  target: string;
  routingKey?: string;
  content: Buffer;
  options: Options.Publish;
}

class FakeChannel extends EventEmitter {
  public readonly published: Published[] = [];
  public publishResult = true;
  public closeCalls = 0;
  public replyHandler?: (msg: unknown) => void;

  public assertQueue = (
    name: string,
    _opts: unknown,
  ): Promise<{ queue: string }> =>
    Promise.resolve({ queue: name || "reply-q" });

  public consume = (
    _queue: string,
    fn: (msg: unknown) => void,
    _opts: unknown,
  ): Promise<{ consumerTag: string }> => {
    this.replyHandler = fn;

    return Promise.resolve({ consumerTag: "reply-tag" });
  };

  public sendToQueue = (
    queue: string,
    content: Buffer,
    options: Options.Publish,
  ): boolean => {
    this.published.push({ target: queue, content, options });

    return this.publishResult;
  };

  public publish = (
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish,
  ): boolean => {
    this.published.push({ target: exchange, routingKey, content, options });

    return this.publishResult;
  };

  public close = (): Promise<void> => {
    this.closeCalls++;
    this.emit("close");

    return Promise.resolve();
  };
}

class FakeConnection extends EventEmitter {
  public closeCalls = 0;

  public constructor(public readonly channel: FakeChannel = new FakeChannel()) {
    super();
  }

  public createChannel = (): Promise<FakeChannel> =>
    Promise.resolve(this.channel);

  public close = (): Promise<void> => {
    this.closeCalls++;
    this.emit("close");

    return Promise.resolve();
  };
}

const serializer = new RmqSerializer();

/** Hands out the given connections to consecutive `amqplib.connect` calls. */
function connectsTo(...connections: FakeConnection[]): () => Promise<never> {
  let next = 0;

  return () => Promise.resolve(connections[next++] as never);
}

/** Lets every pending fake (microtask-only) operation settle. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function lastCorrelationId(ch: FakeChannel): string {
  return ch.published.at(-1)!.options.correlationId!;
}

function reply(
  ch: FakeChannel,
  correlationId: string | undefined,
  payload: unknown,
  contentType?: string,
): void {
  ch.replyHandler!({
    properties: { correlationId, contentType },
    content: Buffer.from(serializer.serialize(payload)),
  });
}

/** Private members some tests inspect. */
interface ClientInternals {
  pending: Map<string, unknown>;
  logger: { error: (...args: unknown[]) => void };
}

describe(RmqClient.name, () => {
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

  describe("connect()", () => {
    it("consumes an exclusive auto-delete reply queue without acks", async () => {
      const conn = new FakeConnection();
      const assertQueue = spy(conn.channel, "assertQueue");
      const consume = spy(conn.channel, "consume");
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      await client.connect();
      await client.close();

      assertEquals(assertQueue.calls[0].args, ["", {
        exclusive: true,
        autoDelete: true,
      }]);
      assertEquals(consume.calls[0].args[0], "reply-q");
      assertEquals(consume.calls[0].args[2], { noAck: true });
    });

    it("shares one connection between concurrent connect() calls", async () => {
      const conn = new FakeConnection();
      using connect = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      await Promise.all([client.connect(), client.connect()]);

      assertEquals(connect.calls.length, 1);
      await client.close();
    });

    it("does not open another connection when already connected", async () => {
      const conn = new FakeConnection();
      using connect = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      await client.connect();
      await client.connect();

      assertEquals(connect.calls.length, 1);
      await client.close();
    });

    it("uses a named replyQueue when provided", async () => {
      const conn = new FakeConnection();
      const assertQueue = spy(conn.channel, "assertQueue");
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({ replyQueue: "my-reply" });
      await client.connect();
      await client.close();

      assertEquals(assertQueue.calls[0].args, ["my-reply", {
        exclusive: false,
        autoDelete: false,
      }]);
    });

    it("closes the connection and rejects when reply-queue setup fails", async () => {
      const failing = new FakeConnection();
      failing.channel.assertQueue = () =>
        Promise.reject(new Error("access refused"));
      const healthy = new FakeConnection();
      using connect = stub(amqplib, "connect", connectsTo(failing, healthy));

      const client = new RmqClient({});

      await assertRejects(() => client.connect(), Error, "access refused");
      assertEquals(failing.closeCalls, 1);

      await client.connect();
      assertEquals(connect.calls.length, 2);
      await client.close();
    });

    it("close() during the retry delay rejects connect() without another attempt", async () => {
      using connect = stub(
        amqplib,
        "connect",
        () => Promise.reject(new Error("refused")),
      );

      const client = new RmqClient({
        maxConnectionAttempts: 3,
        retryDelay: 60_000,
      });
      const outcome = client.connect().catch((err: Error) => err);
      await flush();
      await client.close();

      assertEquals((await outcome as Error).message, "Connection closed");
      assertEquals(connect.calls.length, 1);
    });

    for (
      const stage of [
        "amqplib.connect",
        "createChannel",
        "assertQueue",
        "consume",
      ] as const
    ) {
      it(`close() while waiting for ${stage} closes the late connection`, async () => {
        const gate = Promise.withResolvers<void>();
        const conn = new FakeConnection();
        const ch = conn.channel;
        const { createChannel } = conn;
        const { assertQueue, consume } = ch;

        if (stage === "createChannel") {
          conn.createChannel = () => gate.promise.then(createChannel);
        } else if (stage === "assertQueue") {
          ch.assertQueue = (n, o) => gate.promise.then(() => assertQueue(n, o));
        } else if (stage === "consume") {
          ch.consume = (q, f, o) => gate.promise.then(() => consume(q, f, o));
        }

        const next = new FakeConnection();
        let calls = 0;
        using _s = stub(amqplib, "connect", () => {
          calls++;

          if (calls > 1) {
            return Promise.resolve(next as never);
          }

          return stage === "amqplib.connect"
            ? gate.promise.then(() => conn as never)
            : Promise.resolve(conn as never);
        });

        const client = new RmqClient({});
        const outcome = client.connect().catch((err: Error) => err);
        await flush();
        const closing = client.close();
        gate.resolve();
        await closing;

        assertEquals(conn.closeCalls, 1);
        assertEquals((await outcome as Error).message, "Connection closed");

        // Nothing was installed: the next send needs a new connection.
        const sending = client.send("x", 1);
        await flush();
        reply(next.channel, lastCorrelationId(next.channel), "ok");
        assertEquals(await sending, "ok");
        await client.close();
      });
    }
  });

  describe("connection events", () => {
    it("logs connection and channel errors instead of crashing, also during setup", async () => {
      const gate = Promise.withResolvers<void>();
      const conn = new FakeConnection();
      const { assertQueue } = conn.channel;
      conn.channel.assertQueue = (name, opts) =>
        gate.promise.then(() => assertQueue(name, opts));
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const errorSpy = spy(
        (client as unknown as ClientInternals).logger,
        "error",
      );
      const connecting = client.connect();
      await flush();

      conn.emit("error", new Error("setup conn error"));
      conn.channel.emit("error", new Error("setup channel error"));
      gate.resolve();
      await connecting;
      conn.emit("error", new Error("conn error"));
      conn.channel.emit("error", new Error("channel error"));

      assertEquals(errorSpy.calls.length, 4);
      await client.close();
    });

    it("a channel close rejects pending sends, closes its connection and the next send reconnects", async () => {
      const first = new FakeConnection();
      const second = new FakeConnection();
      using connect = stub(amqplib, "connect", connectsTo(first, second));

      const client = new RmqClient({});
      const pending = client.send("x", 1).catch((err: Error) => err);
      await flush();

      first.channel.emit("close");
      assertEquals((await pending as Error).message, "Connection closed");
      await flush();
      assertEquals(first.closeCalls, 1);

      const sending = client.send("x", 2);
      await flush();
      reply(second.channel, lastCorrelationId(second.channel), "ok");
      assertEquals(await sending, "ok");
      assertEquals(connect.calls.length, 2);

      // A late close event of the replaced connection leaves the new one alone.
      first.emit("close");
      const again = client.send("x", 3);
      await flush();
      reply(second.channel, lastCorrelationId(second.channel), "again");
      assertEquals(await again, "again");
      assertEquals(connect.calls.length, 2);
      await client.close();
    });

    it("a connection close rejects pending sends and the next send reconnects", async () => {
      const first = new FakeConnection();
      const second = new FakeConnection();
      using connect = stub(amqplib, "connect", connectsTo(first, second));

      const client = new RmqClient({});
      const pending = client.send("x", 1).catch((err: Error) => err);
      await flush();

      first.emit("close", new Error("socket reset"));
      assertEquals((await pending as Error).message, "Connection closed");

      const sending = client.send("x", 2);
      await flush();
      reply(second.channel, lastCorrelationId(second.channel), "ok");
      assertEquals(await sending, "ok");
      assertEquals(connect.calls.length, 2);
      await client.close();
    });
  });

  describe("close()", () => {
    it("rejects all pending requests and closes channel and connection", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const pending = client.send("pat", {}).catch((err: Error) => err);
      await flush();
      await client.close();

      assertEquals((await pending as Error).message, "Connection closed");
      assertEquals(conn.channel.closeCalls, 1);
      assertEquals(conn.closeCalls, 1);
    });

    it("is safe to call when not connected", async () => {
      const client = new RmqClient({});
      await client.close();
    });

    it("swallows channel.close() and connection.close() errors", async () => {
      const conn = new FakeConnection();
      conn.channel.close = () => Promise.reject(new Error("channel gone"));
      conn.close = () => {
        throw new Error("conn gone");
      };
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      await client.connect();
      await client.close();
    });

    it("rejects a send waiting for drain without reconnecting", async () => {
      const conn = new FakeConnection();
      conn.channel.publishResult = false;
      using connect = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      await client.emit("x", 1);
      const waiting = client.emit("x", 2).catch((err: Error) => err);
      await flush();
      await client.close();

      assertEquals((await waiting as Error).message, "Connection closed");
      assertEquals(connect.calls.length, 1);
      assertEquals(conn.channel.published.length, 1);
    });

    it("rejects a send whose connect settled right before close()", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const connecting = client.connect();
      const closed = connecting.then(() => client.close());
      const sending = client.send("x", 1).catch((err: Error) => err);
      await closed;

      assertEquals((await sending as Error).message, "Connection closed");
      assertEquals(conn.channel.published.length, 0);
    });
  });

  describe("send()", () => {
    it("publishes to the queue with correlationId and replyTo and resolves from the reply", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({ queue: "my-queue", persistent: true });
      const sending = client.send<{ value: number }>("test", { x: 1 });
      await flush();

      const [message] = conn.channel.published;
      assertEquals(message.target, "my-queue");
      assertEquals(message.options.replyTo, "reply-q");
      assertEquals(message.options.persistent, true);
      assertEquals(JSON.parse(message.content.toString()), { data: { x: 1 } });

      reply(conn.channel, message.options.correlationId, { value: 42 });
      assertEquals(await sending, { value: 42 });
      await client.close();
    });

    it("publishes to the exchange with the routing key when exchange is set", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({
        exchange: "my-exchange",
        routingKey: "rk",
      });
      const sending = client.send<string>("event", "data");
      await flush();

      const [message] = conn.channel.published;
      assertEquals([message.target, message.routingKey], ["my-exchange", "rk"]);
      reply(conn.channel, message.options.correlationId, "response");
      assertEquals(await sending, "response");
      await client.close();
    });

    it("merges configured headers into every message, the pattern header wins", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({
        headers: { tenant: "acme", pattern: "spoofed" },
      });
      const sending = client.send("sum", 1);
      await client.emit({ cmd: "log" }, 2);
      await flush();

      assertEquals(
        conn.channel.published.map((message) => message.options.headers),
        [
          { tenant: "acme", pattern: "sum" },
          { tenant: "acme", pattern: '{"cmd":"log"}' },
        ],
      );
      reply(conn.channel, conn.channel.published[0].options.correlationId, 0);
      await sending;
      await client.close();
    });

    it("sends issued while connecting all carry the reply queue", async () => {
      const gate = Promise.withResolvers<void>();
      const conn = new FakeConnection();
      const { assertQueue } = conn.channel;
      conn.channel.assertQueue = (name, opts) =>
        gate.promise.then(() => assertQueue(name, opts));
      using connect = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const connecting = client.connect();
      await flush();
      const first = client.send("x", 1);
      const second = client.send("x", 2);
      gate.resolve();
      await connecting;
      await flush();

      assertEquals(
        conn.channel.published.map((message) => message.options.replyTo),
        ["reply-q", "reply-q"],
      );
      for (const message of conn.channel.published) {
        reply(conn.channel, message.options.correlationId, "ok");
      }
      assertEquals(await Promise.all([first, second]), ["ok", "ok"]);
      assertEquals(connect.calls.length, 1);
      await client.close();
    });

    it("keeps waiting for the reply under backpressure; the next publish waits for drain", async () => {
      const conn = new FakeConnection();
      conn.channel.publishResult = false;
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const sending = client.send<string>("x", 1);
      await flush();
      reply(conn.channel, lastCorrelationId(conn.channel), "ok");
      assertEquals(await sending, "ok");

      conn.channel.publishResult = true;
      const emitting = client.emit("x", 2);
      await flush();
      assertEquals(conn.channel.published.length, 1);

      conn.channel.emit("drain");
      await emitting;
      assertEquals(conn.channel.published.length, 2);

      await client.emit("x", 3);
      assertEquals(conn.channel.published.length, 3);
      await client.close();
    });

    it("releases every waiting publish on a single drain", async () => {
      const conn = new FakeConnection();
      conn.channel.publishResult = false;
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      await client.connect();
      await Promise.all([client.emit("x", 1), client.emit("x", 2)]);
      const third = client.emit("x", 3);
      const fourth = client.emit("x", 4);
      await flush();
      assertEquals(conn.channel.published.length, 2);

      conn.channel.emit("drain");
      await Promise.all([third, fourth]);
      assertEquals(conn.channel.published.length, 4);
      assertEquals(conn.channel.listenerCount("drain"), 1);
      await client.close();
    });

    it("a channel close releases publishes waiting for drain onto a new connection", async () => {
      const first = new FakeConnection();
      first.channel.publishResult = false;
      const second = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(first, second));

      const client = new RmqClient({});
      await client.emit("x", 1);
      const waiting = client.emit("x", 2);
      await flush();

      first.channel.emit("close");
      await waiting;

      assertEquals(first.channel.published.length, 1);
      assertEquals(second.channel.published.length, 1);
      await client.close();
    });

    it("rejects before connecting when the payload cannot be serialized", async () => {
      using connect = stub(amqplib, "connect", connectsTo());

      const client = new RmqClient({});

      await assertRejects(() => client.send("x", 10n), TypeError);
      assertEquals(connect.calls.length, 0);
      assertEquals((client as unknown as ClientInternals).pending.size, 0);
    });

    it("rejects and forgets the request when publishing throws", async () => {
      const conn = new FakeConnection();
      const failure = new Error("Channel closing");
      conn.channel.sendToQueue = () => {
        throw failure;
      };
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const error = await assertRejects(() => client.send("x", 1));

      assertStrictEquals(error, failure);
      assertEquals((client as unknown as ClientInternals).pending.size, 0);
      await client.close();
    });

    it("rejects when the reply contains an err field", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const sending = client.send("test", {});
      await flush();
      reply(conn.channel, lastCorrelationId(conn.channel), {
        err: "remote error",
      });

      await assertRejects(() => sending, Error, "remote error");
      await client.close();
    });

    it("rejects when the reply content is not valid JSON", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const sending = client.send("test", {});
      await flush();
      conn.channel.replyHandler!({
        properties: { correlationId: lastCorrelationId(conn.channel) },
        content: Buffer.from("not-json"),
      });

      await assertRejects(() => sending, Error, "Failed to parse reply");
      await client.close();
    });

    it("resolves raw bytes for an application/octet-stream reply", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const sending = client.send<Uint8Array>("test", {});
      await flush();
      reply(
        conn.channel,
        lastCorrelationId(conn.channel),
        new Uint8Array([1, 2, 3]),
        "application/octet-stream",
      );

      assertEquals(await sending, new Uint8Array([1, 2, 3]));
      await client.close();
    });

    it("resolves null for a null reply", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const sending = client.send("test", {});
      await flush();
      reply(conn.channel, lastCorrelationId(conn.channel), null);

      assertEquals(await sending, null);
      await client.close();
    });

    it("ignores replies without or with an unknown correlationId", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      const sending = client.send("test", {});
      await flush();
      reply(conn.channel, undefined, "no id");
      reply(conn.channel, "unknown-correlation-id", "unknown");
      conn.channel.replyHandler!(null);
      reply(conn.channel, lastCorrelationId(conn.channel), "mine");

      assertEquals(await sending, "mine");
      await client.close();
    });
  });

  describe("emit()", () => {
    it("publishes a fire-and-forget message to the queue", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({});
      await client.emit("event.fired", { payload: 1 });
      await client.close();

      const [message] = conn.channel.published;
      assertEquals(message.target, "denorid");
      assertEquals(message.options.correlationId, undefined);
      assertEquals(message.options.replyTo, undefined);
    });

    it("publishes to the exchange with the default routing key", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      const client = new RmqClient({ exchange: "ex" });
      await client.emit("x", {});
      await client.close();

      const [message] = conn.channel.published;
      assertEquals([message.target, message.routingKey], ["ex", ""]);
    });
  });

  describe("[Symbol.asyncDispose]()", () => {
    it("closes the client when an await using block exits", async () => {
      const conn = new FakeConnection();
      using _s = stub(amqplib, "connect", connectsTo(conn));

      {
        await using client = new RmqClient({});
        await client.connect();
      }

      assertEquals(conn.channel.closeCalls, 1);
      assertEquals(conn.closeCalls, 1);
    });
  });
});
