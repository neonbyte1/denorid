import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import {
  PublisherClient,
  RoutingClient,
  RpcClient,
  TopicClient,
  WorkerClient,
} from "./clients.ts";
import type { AmqpConnection } from "./connection.ts";
import { JsonAmqpSerializer } from "./serialization.ts";

const serializer = new JsonAmqpSerializer();

interface RecordedCall {
  method: string;
  args: unknown[];
}

class FakeChannel extends EventEmitter {
  public readonly calls: RecordedCall[] = [];
  public consumeCallback?: (msg: unknown) => void;
  public assertQueueGate?: Promise<void>;

  public constructor(private readonly replyQueue = "amq.gen-reply") {
    super();
  }

  public async assertQueue(
    queue: string,
    opts: unknown,
  ): Promise<{ queue: string }> {
    this.calls.push({ method: "assertQueue", args: [queue, opts] });
    await this.assertQueueGate;

    return { queue: queue || this.replyQueue };
  }

  public assertExchange(
    exchange: string,
    type: string,
    opts: unknown,
  ): Promise<unknown> {
    this.calls.push({ method: "assertExchange", args: [exchange, type, opts] });

    return Promise.resolve({ exchange });
  }

  public publish(
    exchange: string,
    key: string,
    content: Buffer,
    opts?: unknown,
  ): boolean {
    this.calls.push({
      method: "publish",
      args: [exchange, key, content, opts],
    });

    return true;
  }

  public sendToQueue(queue: string, content: Buffer, opts?: unknown): boolean {
    this.calls.push({ method: "sendToQueue", args: [queue, content, opts] });

    return true;
  }

  public consume(
    queue: string,
    fn: (msg: unknown) => void,
    opts: unknown,
  ): Promise<{ consumerTag: string }> {
    this.calls.push({ method: "consume", args: [queue, opts] });
    this.consumeCallback = fn;

    return Promise.resolve({ consumerTag: "tag" });
  }

  public close(): Promise<void> {
    this.calls.push({ method: "close", args: [] });
    this.emit("close");

    return Promise.resolve();
  }

  /** Delivers a reply to the consumed reply queue. */
  public reply(
    correlationId: string | undefined,
    content: Buffer,
    contentType?: string,
  ): void {
    this.consumeCallback!({
      properties: { correlationId, contentType },
      content,
    });
  }
}

function makeConnection(...channels: FakeChannel[]): {
  connection: AmqpConnection;
  channelCalls: number;
} {
  let channelCalls = 0;
  const connection = {
    serializer,
    createChannel: () => {
      const channel = channels[Math.min(channelCalls, channels.length - 1)];

      channelCalls++;

      return Promise.resolve(channel);
    },
  } as unknown as AmqpConnection;

  return {
    connection,
    get channelCalls(): number {
      return channelCalls;
    },
  };
}

function call(channel: FakeChannel, method: string): RecordedCall | undefined {
  return channel.calls.find((c) => c.method === method);
}

function count(channel: FakeChannel, method: string): number {
  return channel.calls.filter((c) => c.method === method).length;
}

interface SendOptions {
  correlationId: string;
  replyTo?: string;
  contentType?: string;
  persistent?: boolean;
}

function sentOptions(channel: FakeChannel, index = 0): SendOptions {
  // Recorded verbatim from the client's `sendToQueue(queue, content, options)`.
  const options = channel.calls.filter((c) => c.method === "sendToQueue")[index]
    .args[2] as SendOptions;

  return options;
}

function flush(ms = 0): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);

  return promise;
}

describe(WorkerClient.name, () => {
  it("asserts the queue and sends a persistent JSON payload", async () => {
    const channel = new FakeChannel();
    const { connection } = makeConnection(channel);
    const client = new WorkerClient(connection, { queue: "tasks" });

    await client.send({ job: 1 });

    const assertCall = call(channel, "assertQueue")!;
    assertEquals(assertCall.args[0], "tasks");
    assertEquals(assertCall.args[1], { durable: true });

    const sendCall = call(channel, "sendToQueue")!;
    assertEquals(sendCall.args[0], "tasks");
    assertEquals(serializer.deserialize(sendCall.args[1] as Buffer), {
      job: 1,
    });
    assertEquals(sendCall.args[2], {
      persistent: true,
      contentType: "application/json",
    });
  });

  it("tags a binary payload so receivers skip JSON parsing", async () => {
    const channel = new FakeChannel();
    const { connection } = makeConnection(channel);
    const client = new WorkerClient(connection, { queue: "tasks" });

    await client.send(new Uint8Array([1, 2]));

    assertEquals(sentOptions(channel).contentType, "application/octet-stream");
  });

  it("asserts the queue only once across two sends", async () => {
    const channel = new FakeChannel();
    const { connection } = makeConnection(channel);
    const client = new WorkerClient(connection, { queue: "tasks" });

    await client.send({ a: 1 });
    await client.send({ b: 2 });

    assertEquals(count(channel, "assertQueue"), 1);
    assertEquals(count(channel, "sendToQueue"), 2);
  });

  it("opens a single channel for concurrent first sends", async () => {
    const channel = new FakeChannel();
    const tracked = makeConnection(channel);
    const client = new WorkerClient(tracked.connection, { queue: "tasks" });

    await Promise.all([client.send({ a: 1 }), client.send({ b: 2 })]);

    assertEquals(tracked.channelCalls, 1);
    assertEquals(count(channel, "assertQueue"), 1);
    assertEquals(count(channel, "sendToQueue"), 2);
  });

  it("honors durable and persistent overrides", async () => {
    const channel = new FakeChannel();
    const { connection } = makeConnection(channel);
    const client = new WorkerClient(connection, {
      queue: "tasks",
      durable: false,
      persistent: false,
    });

    await client.send({ x: 1 });

    assertEquals(call(channel, "assertQueue")!.args[1], { durable: false });
    assertEquals(call(channel, "sendToQueue")!.args[2], {
      persistent: false,
      contentType: "application/json",
    });
  });

  it("omits the content type when the serializer does not provide one", async () => {
    const channel = new FakeChannel();
    const connection = {
      serializer: { serialize: () => Buffer.from("x"), deserialize: () => 0 },
      createChannel: () => Promise.resolve(channel),
    } as unknown as AmqpConnection;
    const client = new WorkerClient(connection, { queue: "tasks" });

    await client.send({ x: 1 });

    assertEquals(sentOptions(channel).contentType, undefined);
  });

  it("opens a new channel after the previous one closed", async () => {
    const first = new FakeChannel();
    const second = new FakeChannel();
    const tracked = makeConnection(first, second);
    const client = new WorkerClient(tracked.connection, { queue: "tasks" });

    await client.send({ a: 1 });
    first.emit("close");
    await client.send({ b: 2 });

    assertEquals(tracked.channelCalls, 2);
    assertEquals(count(first, "sendToQueue"), 1);
    assertEquals(count(second, "sendToQueue"), 1);
    assertEquals(count(second, "assertQueue"), 1);
  });

  it("closes the channel and retries on the next send when the setup fails", async () => {
    const failing = new FakeChannel();
    const healthy = new FakeChannel();
    failing.assertQueue = () => Promise.reject(new Error("406 PRECONDITION"));
    const tracked = makeConnection(failing, healthy);
    const client = new WorkerClient(tracked.connection, { queue: "tasks" });

    await assertRejects(() => client.send({ a: 1 }), Error, "406");
    assertEquals(count(failing, "close"), 1);

    await client.send({ b: 2 });

    assertEquals(tracked.channelCalls, 2);
    assertEquals(count(healthy, "sendToQueue"), 1);
  });

  it("rethrows the setup error even when closing the channel fails", async () => {
    const channel = new FakeChannel();
    channel.assertQueue = () => Promise.reject(new Error("406 PRECONDITION"));
    channel.close = () => Promise.reject(new Error("already closed"));
    const { connection } = makeConnection(channel);
    const client = new WorkerClient(connection, { queue: "tasks" });

    await assertRejects(() => client.send({ a: 1 }), Error, "406");
  });

  it("propagates a createChannel failure and retries on the next send", async () => {
    const channel = new FakeChannel();
    let attempts = 0;
    const connection = {
      serializer,
      createChannel: () =>
        ++attempts === 1
          ? Promise.reject(new Error("ECONNREFUSED"))
          : Promise.resolve(channel),
    } as unknown as AmqpConnection;
    const client = new WorkerClient(connection, { queue: "tasks" });

    await assertRejects(() => client.send({ a: 1 }), Error, "ECONNREFUSED");
    await client.send({ b: 2 });

    assertEquals(count(channel, "sendToQueue"), 1);
  });
});

describe(PublisherClient.name, () => {
  it("asserts a fanout exchange and publishes with an empty routing key", async () => {
    const channel = new FakeChannel();
    const { connection } = makeConnection(channel);
    const client = new PublisherClient(connection, { exchange: "logs" });

    await client.publish({ event: "x" });

    assertEquals(call(channel, "assertExchange")!.args, [
      "logs",
      "fanout",
      { durable: true },
    ]);

    const publishCall = call(channel, "publish")!;
    assertEquals(publishCall.args[0], "logs");
    assertEquals(publishCall.args[1], "");
    assertEquals(serializer.deserialize(publishCall.args[2] as Buffer), {
      event: "x",
    });
    assertEquals(publishCall.args[3], { contentType: "application/json" });
  });
});

describe(RoutingClient.name, () => {
  it("asserts a direct exchange and publishes under the routing key", async () => {
    const channel = new FakeChannel();
    const { connection } = makeConnection(channel);
    const client = new RoutingClient(connection, { exchange: "alerts" });

    await client.publish("error", { msg: "boom" });

    assertEquals(call(channel, "assertExchange")!.args, [
      "alerts",
      "direct",
      { durable: true },
    ]);

    const publishCall = call(channel, "publish")!;
    assertEquals(publishCall.args[0], "alerts");
    assertEquals(publishCall.args[1], "error");
    assertEquals(serializer.deserialize(publishCall.args[2] as Buffer), {
      msg: "boom",
    });
    assertEquals(publishCall.args[3], { contentType: "application/json" });
  });
});

describe(TopicClient.name, () => {
  it("asserts a topic exchange and publishes under the pattern key", async () => {
    const channel = new FakeChannel();
    const { connection } = makeConnection(channel);
    const client = new TopicClient(connection, { exchange: "metrics" });

    await client.publish("a.*", { x: 1 });

    assertEquals(call(channel, "assertExchange")!.args, [
      "metrics",
      "topic",
      { durable: true },
    ]);

    const publishCall = call(channel, "publish")!;
    assertEquals(publishCall.args[0], "metrics");
    assertEquals(publishCall.args[1], "a.*");
    assertEquals(serializer.deserialize(publishCall.args[2] as Buffer), {
      x: 1,
    });
    assertEquals(publishCall.args[3], { contentType: "application/json" });
  });
});

describe(RpcClient.name, () => {
  it("asserts an exclusive reply queue, consumes it, and sends with correlation", async () => {
    const channel = new FakeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc" });

    const promise = client.request({ a: 1, b: 2 });
    await flush();

    const assertCall = call(channel, "assertQueue")!;
    assertEquals(assertCall.args[0], "");
    assertEquals(assertCall.args[1], { exclusive: true, autoDelete: true });

    const consumeCall = call(channel, "consume")!;
    assertEquals(consumeCall.args[0], "reply-q");
    assertEquals(consumeCall.args[1], { noAck: true });

    const sendCall = call(channel, "sendToQueue")!;
    assertEquals(sendCall.args[0], "rpc");
    assertEquals(serializer.deserialize(sendCall.args[1] as Buffer), {
      a: 1,
      b: 2,
    });
    const opts = sentOptions(channel);
    assertEquals(opts.replyTo, "reply-q");
    assertEquals(opts.contentType, "application/json");

    channel.reply(opts.correlationId, Buffer.from(JSON.stringify({ sum: 3 })));

    assertEquals(await promise, { sum: 3 });
    await client.close();
  });

  it("sends concurrent first requests on one channel, all with the reply queue", async () => {
    const channel = new FakeChannel("reply-q");
    const gate = Promise.withResolvers<void>();
    channel.assertQueueGate = gate.promise;
    const tracked = makeConnection(channel);
    const client = new RpcClient(tracked.connection, { queue: "rpc" });

    const first = client.request({ n: 1 });
    await flush();
    const second = client.request({ n: 2 });
    await flush();

    // Nothing is published while the reply queue is still being asserted.
    assertEquals(count(channel, "sendToQueue"), 0);

    gate.resolve();
    await flush();

    assertEquals(tracked.channelCalls, 1);
    assertEquals(sentOptions(channel, 0).replyTo, "reply-q");
    assertEquals(sentOptions(channel, 1).replyTo, "reply-q");

    channel.reply(sentOptions(channel, 0).correlationId, Buffer.from("1"));
    channel.reply(sentOptions(channel, 1).correlationId, Buffer.from("2"));

    assertEquals(await Promise.all([first, second]), [1, 2]);
    await client.close();
  });

  it("rejects when the reply carries an err field", async () => {
    const channel = new FakeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc" });

    const promise = client.request({ x: 1 });
    await flush();

    channel.reply(
      sentOptions(channel).correlationId,
      Buffer.from(JSON.stringify({ err: "remote boom" })),
    );

    await assertRejects(() => promise, Error, "remote boom");
    await client.close();
  });

  it("rejects the request instead of throwing when the reply cannot be parsed", async () => {
    const channel = new FakeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc", timeout: 1_000 });

    const promise = client.request({ x: 1 });
    await flush();

    // Runs inside amqplib's delivery dispatch: a throw here kills the process.
    channel.reply(sentOptions(channel).correlationId, Buffer.from("hello"));

    const err = await assertRejects(
      () => promise,
      Error,
      "Failed to parse reply message",
    );
    assertInstanceOf(err.cause, SyntaxError);
    await client.close();
  });

  it("resolves a binary reply with its raw bytes", async () => {
    const channel = new FakeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc" });

    const promise = client.request({ x: 1 });
    await flush();

    channel.reply(
      sentOptions(channel).correlationId,
      Buffer.from("hello"),
      "application/octet-stream",
    );

    assertEquals(
      new TextDecoder().decode(await promise as Uint8Array),
      "hello",
    );
    await client.close();
  });

  it("ignores a reply with no correlationId and an unknown correlationId", async () => {
    const channel = new FakeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc" });

    const promise = client.request({ x: 1 });
    await flush();

    channel.reply(undefined, Buffer.from("{}"));
    channel.reply("unknown", Buffer.from("{}"));
    channel.consumeCallback!(null);
    channel.reply(
      sentOptions(channel).correlationId,
      Buffer.from(JSON.stringify("ok")),
    );

    assertEquals(await promise, "ok");
    await client.close();
  });

  it("rejects after the timeout elapses when no reply arrives", async () => {
    const channel = new FakeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc", timeout: 10 });

    await assertRejects(
      () => client.request({ x: 1 }),
      Error,
      "RPC request timed out",
    );

    await client.close();
  });

  it("clears the timeout timer when a reply arrives before it fires", async () => {
    const channel = new FakeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc", timeout: 1_000 });

    const promise = client.request({ x: 1 });
    await flush();

    channel.reply(
      sentOptions(channel).correlationId,
      Buffer.from(JSON.stringify({ ok: true })),
    );

    assertEquals(await promise, { ok: true });
    // close() must not throw even though the timer was already cleared.
    await client.close();
  });

  it("rejects without arming a timer when the payload cannot be serialized", async () => {
    const channel = new FakeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc", timeout: 10 });

    await assertRejects(() => client.request({ id: 1n }), TypeError);

    // An armed timer would reject an orphaned promise here and fail the run
    // with an unhandled rejection.
    await flush(30);
    assertEquals(count(channel, "sendToQueue"), 0);
    await client.close();
  });

  it("rejects without arming a timer when sending throws", async () => {
    const channel = new FakeChannel("reply-q");
    channel.sendToQueue = () => {
      throw new Error("Channel closed");
    };
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc", timeout: 10 });

    await assertRejects(
      () => client.request({ x: 1 }),
      Error,
      "Channel closed",
    );

    await flush(30);
    await client.close();
  });

  it("rejects pending requests when their channel closes and reconnects on the next request", async () => {
    const first = new FakeChannel("reply-1");
    const second = new FakeChannel("reply-2");
    const tracked = makeConnection(first, second);
    const client = new RpcClient(tracked.connection, {
      queue: "rpc",
      timeout: 1_000,
    });

    const lost = client.request({ x: 1 });
    await flush();

    first.emit("close");

    await assertRejects(() => lost, Error, "RPC channel closed");

    const next = client.request({ x: 2 });
    await flush();

    assertEquals(tracked.channelCalls, 2);
    assertEquals(sentOptions(second).replyTo, "reply-2");

    second.reply(sentOptions(second).correlationId, Buffer.from("2"));
    assertEquals(await next, 2);
    await client.close();
  });

  it("keeps requests sent on a newer channel when an old channel closes late", async () => {
    const first = new FakeChannel("reply-1");
    const second = new FakeChannel("reply-2");
    const closed = Promise.withResolvers<void>();
    first.close = () => {
      first.calls.push({ method: "close", args: [] });

      return closed.promise.then(() => {
        first.emit("close");
      });
    };
    const { connection } = makeConnection(first, second);
    const client = new RpcClient(connection, { queue: "rpc" });

    const old = client.request({ x: 1 }).catch((err: Error) => err.message);
    await flush();

    const closing = client.close();
    const current = client.request({ x: 2 });
    await flush();

    closed.resolve();
    await closing;

    second.reply(sentOptions(second).correlationId, Buffer.from("2"));

    assertEquals(await old, "Connection closed");
    assertEquals(await current, 2);
    await client.close();
  });

  it("rejects an in-flight request on close and is idempotent", async () => {
    const channel = new FakeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc" });

    const promise = client.request({ x: 1 });
    await flush();

    const rejection = assertRejects(() => promise, Error, "Connection closed");
    await client.close();
    await rejection;

    // Second close with no channel is a no-op.
    await client.close();
    assertEquals(count(channel, "close"), 1);
  });
});

describe("client teardown", () => {
  it("close before any send is a no-op", async () => {
    const channel = new FakeChannel();
    const { connection } = makeConnection(channel);
    const client = new PublisherClient(connection, { exchange: "ex" });

    await client.close();

    assertStrictEquals(call(channel, "close"), undefined);
  });

  it("closes a channel that was still being set up", async () => {
    const channel = new FakeChannel();
    const gate = Promise.withResolvers<void>();
    channel.assertQueueGate = gate.promise;
    const { connection } = makeConnection(channel);
    const client = new WorkerClient(connection, { queue: "tasks" });

    const sending = client.send({ a: 1 });
    await flush();

    const closing = client.close();
    gate.resolve();

    await sending;
    await closing;

    assertEquals(count(channel, "close"), 1);
  });

  it("disposing closes the channel for every client type", async () => {
    const channel = new FakeChannel("reply-q");
    const { connection } = makeConnection(channel);

    {
      await using publisher = new PublisherClient(connection, {
        exchange: "ex",
      });
      await publisher.publish({ a: 1 });
    }

    {
      await using routing = new RoutingClient(connection, { exchange: "ex" });
      await routing.publish("rk", { a: 1 });
    }

    {
      await using topic = new TopicClient(connection, { exchange: "ex" });
      await topic.publish("a.*", { a: 1 });
    }

    {
      await using worker = new WorkerClient(connection, { queue: "q" });
      await worker.send({ a: 1 });
    }

    let rejected: Promise<unknown>;

    {
      await using rpc = new RpcClient(connection, { queue: "rpc" });
      rejected = rpc.request({ a: 1 }).catch((err: Error) => err.message);
      await flush();
    }

    assertEquals(await rejected, "Connection closed");
    assertEquals(count(channel, "close"), 5);
  });

  it("swallows a throwing channel.close()", async () => {
    const channel = new FakeChannel("reply-q");
    channel.close = () => Promise.reject(new Error("close failed"));
    const { connection } = makeConnection(channel);
    const rpc = new RpcClient(connection, { queue: "rpc" });

    const rejected = rpc.request({ a: 1 }).catch(() => {});
    await flush();
    await rpc.close();
    await rejected;
  });
});
