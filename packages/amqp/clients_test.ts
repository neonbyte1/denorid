import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { Buffer } from "node:buffer";
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

interface FakeChannel {
  calls: RecordedCall[];
  consumeCallback?: (msg: unknown) => void;
  assertQueue: (queue: string, opts: unknown) => Promise<{ queue: string }>;
  assertExchange: (
    exchange: string,
    type: string,
    opts: unknown,
  ) => Promise<unknown>;
  publish: (
    exchange: string,
    key: string,
    content: Buffer,
    opts?: unknown,
  ) => boolean;
  sendToQueue: (queue: string, content: Buffer, opts?: unknown) => boolean;
  consume: (
    queue: string,
    fn: (msg: unknown) => void,
    opts: unknown,
  ) => Promise<{ consumerTag: string }>;
  close: () => Promise<void>;
}

function makeChannel(replyQueue = "amq.gen-reply"): FakeChannel {
  const channel: FakeChannel = {
    calls: [],
    assertQueue: (queue, opts) => {
      channel.calls.push({ method: "assertQueue", args: [queue, opts] });

      return Promise.resolve({ queue: queue || replyQueue });
    },
    assertExchange: (exchange, type, opts) => {
      channel.calls.push({
        method: "assertExchange",
        args: [exchange, type, opts],
      });

      return Promise.resolve({ exchange });
    },
    publish: (exchange, key, content, opts) => {
      channel.calls.push({
        method: "publish",
        args: [exchange, key, content, opts],
      });

      return true;
    },
    sendToQueue: (queue, content, opts) => {
      channel.calls.push({
        method: "sendToQueue",
        args: [queue, content, opts],
      });

      return true;
    },
    consume: (queue, fn, opts) => {
      channel.calls.push({ method: "consume", args: [queue, opts] });
      channel.consumeCallback = fn;

      return Promise.resolve({ consumerTag: "tag" });
    },
    close: () => {
      channel.calls.push({ method: "close", args: [] });

      return Promise.resolve();
    },
  };

  return channel;
}

function makeConnection(channel: FakeChannel): {
  connection: AmqpConnection;
  channelCalls: number;
} {
  let channelCalls = 0;
  const connection = {
    serializer,
    createChannel: () => {
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

function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);

  return promise;
}

describe(WorkerClient.name, () => {
  it("asserts the queue and sends a persistent payload", async () => {
    const channel = makeChannel();
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
    assertEquals(sendCall.args[2], { persistent: true });
  });

  it("asserts the queue only once across two sends", async () => {
    const channel = makeChannel();
    const { connection } = makeConnection(channel);
    const client = new WorkerClient(connection, { queue: "tasks" });

    await client.send({ a: 1 });
    await client.send({ b: 2 });

    assertEquals(
      channel.calls.filter((c) => c.method === "assertQueue").length,
      1,
    );
    assertEquals(
      channel.calls.filter((c) => c.method === "sendToQueue").length,
      2,
    );
  });

  it("honors durable and persistent overrides", async () => {
    const channel = makeChannel();
    const { connection } = makeConnection(channel);
    const client = new WorkerClient(connection, {
      queue: "tasks",
      durable: false,
      persistent: false,
    });

    await client.send({ x: 1 });

    assertEquals(call(channel, "assertQueue")!.args[1], { durable: false });
    assertEquals(call(channel, "sendToQueue")!.args[2], { persistent: false });
  });
});

describe(PublisherClient.name, () => {
  it("asserts a fanout exchange and publishes with an empty routing key", async () => {
    const channel = makeChannel();
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
  });
});

describe(RoutingClient.name, () => {
  it("asserts a direct exchange and publishes under the routing key", async () => {
    const channel = makeChannel();
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
  });
});

describe(TopicClient.name, () => {
  it("asserts a topic exchange and publishes under the pattern key", async () => {
    const channel = makeChannel();
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
  });
});

describe(RpcClient.name, () => {
  it("asserts an exclusive reply queue, consumes it, and sends with correlation", async () => {
    const channel = makeChannel("reply-q");
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
    const opts = sendCall.args[2] as { correlationId: string; replyTo: string };
    assertEquals(opts.replyTo, "reply-q");

    channel.consumeCallback!({
      properties: { correlationId: opts.correlationId },
      content: Buffer.from(JSON.stringify({ sum: 3 })),
    });

    assertEquals(await promise, { sum: 3 });
    await client.close();
  });

  it("rejects when the reply carries an err field", async () => {
    const channel = makeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc" });

    const promise = client.request({ x: 1 });
    await flush();

    const opts = call(channel, "sendToQueue")!.args[2] as {
      correlationId: string;
    };
    channel.consumeCallback!({
      properties: { correlationId: opts.correlationId },
      content: Buffer.from(JSON.stringify({ err: "remote boom" })),
    });

    await assertRejects(() => promise, Error, "remote boom");
    await client.close();
  });

  it("ignores a reply with no correlationId and an unknown correlationId", async () => {
    const channel = makeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc" });

    const promise = client.request({ x: 1 });
    await flush();

    channel.consumeCallback!({ properties: {}, content: Buffer.from("{}") });
    channel.consumeCallback!({
      properties: { correlationId: "unknown" },
      content: Buffer.from("{}"),
    });

    const opts = call(channel, "sendToQueue")!.args[2] as {
      correlationId: string;
    };
    channel.consumeCallback!({
      properties: { correlationId: opts.correlationId },
      content: Buffer.from(JSON.stringify("ok")),
    });

    assertEquals(await promise, "ok");
    await client.close();
  });

  it("rejects after the timeout elapses when no reply arrives", async () => {
    const channel = makeChannel("reply-q");
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
    const channel = makeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc", timeout: 1_000 });

    const promise = client.request({ x: 1 });
    await flush();

    const opts = call(channel, "sendToQueue")!.args[2] as {
      correlationId: string;
    };
    channel.consumeCallback!({
      properties: { correlationId: opts.correlationId },
      content: Buffer.from(JSON.stringify({ ok: true })),
    });

    assertEquals(await promise, { ok: true });
    // close() must not throw even though the timer was already cleared.
    await client.close();
  });

  it("rejects an in-flight request on close and is idempotent", async () => {
    const channel = makeChannel("reply-q");
    const { connection } = makeConnection(channel);
    const client = new RpcClient(connection, { queue: "rpc" });

    const promise = client.request({ x: 1 });
    await flush();

    const rejection = assertRejects(() => promise, Error, "Connection closed");
    await client.close();
    await rejection;

    // Second close with no channel is a no-op.
    await client.close();
    assertEquals(
      channel.calls.filter((c) => c.method === "close").length,
      1,
    );
  });
});

describe("client teardown", () => {
  it("WorkerClient.onBeforeApplicationShutdown closes the channel", async () => {
    const channel = makeChannel();
    const { connection } = makeConnection(channel);
    const client = new WorkerClient(connection, { queue: "tasks" });

    await client.send({ x: 1 });
    await client.onBeforeApplicationShutdown();

    assertEquals(call(channel, "close")!.method, "close");
  });

  it("close before any send is a no-op", async () => {
    const channel = makeChannel();
    const { connection } = makeConnection(channel);
    const client = new PublisherClient(connection, { exchange: "ex" });

    await client.close();

    assertStrictEquals(call(channel, "close"), undefined);
  });

  it("onBeforeApplicationShutdown closes the channel for every client type", async () => {
    const channel = makeChannel("reply-q");
    const { connection } = makeConnection(channel);

    const publisher = new PublisherClient(connection, { exchange: "ex" });
    await publisher.publish({ a: 1 });
    await publisher.onBeforeApplicationShutdown();

    const routing = new RoutingClient(connection, { exchange: "ex" });
    await routing.publish("rk", { a: 1 });
    await routing.onBeforeApplicationShutdown();

    const topic = new TopicClient(connection, { exchange: "ex" });
    await topic.publish("a.*", { a: 1 });
    await topic.onBeforeApplicationShutdown();

    const rpc = new RpcClient(connection, { queue: "rpc" });
    const rejected = rpc.request({ a: 1 }).catch(() => {});
    await flush();
    await rpc.onBeforeApplicationShutdown();
    await rejected;

    assertEquals(
      channel.calls.filter((c) => c.method === "close").length,
      4,
    );
  });

  it("swallows a throwing channel.close() for every client type", async () => {
    const failingClose = (): Promise<void> =>
      Promise.reject(new Error("close failed"));

    const workerChannel = makeChannel();
    workerChannel.close = failingClose;
    const worker = new WorkerClient(
      makeConnection(workerChannel).connection,
      { queue: "tasks" },
    );
    await worker.send({ a: 1 });
    await worker.close();

    const publisherChannel = makeChannel();
    publisherChannel.close = failingClose;
    const publisher = new PublisherClient(
      makeConnection(publisherChannel).connection,
      { exchange: "ex" },
    );
    await publisher.publish({ a: 1 });
    await publisher.close();

    const routingChannel = makeChannel();
    routingChannel.close = failingClose;
    const routing = new RoutingClient(
      makeConnection(routingChannel).connection,
      { exchange: "ex" },
    );
    await routing.publish("rk", { a: 1 });
    await routing.close();

    const topicChannel = makeChannel();
    topicChannel.close = failingClose;
    const topic = new TopicClient(
      makeConnection(topicChannel).connection,
      { exchange: "ex" },
    );
    await topic.publish("a.*", { a: 1 });
    await topic.close();

    const rpcChannel = makeChannel("reply-q");
    rpcChannel.close = failingClose;
    const rpc = new RpcClient(
      makeConnection(rpcChannel).connection,
      { queue: "rpc" },
    );
    const rejected = rpc.request({ a: 1 }).catch(() => {});
    await flush();
    await rpc.close();
    await rejected;
  });
});
