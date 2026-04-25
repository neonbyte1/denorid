import { assertEquals, assertRejects } from "@std/assert";
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import amqplib from "amqplib";
import { Buffer } from "node:buffer";
import { mockStdWrite, type RestoreFn } from "../_test_utils.ts";
import { RmqClient } from "./client.ts";
import { RmqSerializer } from "./serializer.ts";

describe(RmqClient.name, () => {
  const serializer = new RmqSerializer();

  interface MockChannel {
    assertQueue: (name: string, opts: unknown) => Promise<{ queue: string }>;
    consume: (
      queue: string,
      fn: (msg: unknown) => void,
      opts: unknown,
    ) => Promise<void>;
    sendToQueue: (q: string, buf: Buffer, opts: unknown) => boolean;
    publish: (
      exchange: string,
      key: string,
      buf: Buffer,
      opts: unknown,
    ) => boolean;
    close: () => Promise<void>;
    _replyHandler?: (msg: unknown) => void;
  }

  interface MockConnection {
    createChannel: () => Promise<MockChannel>;
    close: () => Promise<void>;
    on: (event: string, fn: () => void) => void;
  }

  function makeChannel(opts: {
    sendToQueueReturn?: boolean;
    publishReturn?: boolean;
  } = {}): MockChannel {
    const ch: MockChannel = {
      assertQueue: (_name, _opts) =>
        Promise.resolve({ queue: _name || "reply-q" }),
      consume: (_queue, fn, _opts) => {
        ch._replyHandler = fn;

        return Promise.resolve();
      },
      sendToQueue: (_q, _buf, _opts) => opts.sendToQueueReturn ?? true,
      publish: (_ex, _key, _buf, _opts) => opts.publishReturn ?? true,
      close: () => Promise.resolve(),
    };
    return ch;
  }

  function makeConnection(ch: MockChannel): MockConnection {
    return {
      createChannel: () => Promise.resolve(ch),
      close: () => Promise.resolve(),
      on: () => {},
    };
  }

  function buildReplyMsg(
    correlationId: string,
    payload: unknown,
    contentType?: string,
  ): {
    properties: { correlationId: string; contentType?: string };
    content: Buffer;
  } {
    const body = Buffer.from(serializer.serialize(payload));
    return {
      properties: { correlationId, contentType },
      content: body,
    };
  }

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

  describe("connect()", () => {
    it("connects successfully with default options", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();
      await client.close();
    });

    it("is idempotent - concurrent connect() calls resolve once", async () => {
      let calls = 0;
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => {
        calls++;
        return Promise.resolve(conn as never);
      });

      const client = new RmqClient({});
      await Promise.all([client.connect(), client.connect()]);
      assertEquals(calls, 1);
      await client.close();
    });

    it("uses a named replyQueue when provided", async () => {
      let queueName = "";
      const ch = makeChannel();
      ch.assertQueue = (name, _opts) => {
        queueName = name;
        return Promise.resolve({ queue: name });
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({ replyQueue: "my-reply" });
      await client.connect();
      await client.close();

      assertEquals(queueName, "my-reply");
    });
  });

  describe("close()", () => {
    it("rejects all pending requests", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();

      const sendPromise = client.send("pat", {}).catch((e) => e as Error);
      // flush one microtask level so send()'s ensureConnected() resolves and
      // the entry is added to pending before close() clears it
      await Promise.resolve();
      await client.close();

      const err = await sendPromise as Error;
      assertEquals(err.message, "Connection closed");
    });

    it("is safe to call when not connected", async () => {
      const client = new RmqClient({});
      await client.close();
    });

    it("swallows channel.close() error", async () => {
      const ch = makeChannel();
      ch.close = () => Promise.reject(new Error("channel gone"));
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();
      await client.close(); // must not throw
    });

    it("swallows connection.close() error", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      conn.close = () => Promise.reject(new Error("conn gone"));
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();
      await client.close(); // must not throw
    });
  });

  describe("send()", () => {
    it("resolves when matching reply arrives via sendToQueue", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({ queue: "my-queue" });
      await client.connect();

      let capturedCorrelationId = "";
      ch.sendToQueue = (_q, _buf, opts) => {
        capturedCorrelationId =
          (opts as { correlationId: string }).correlationId;
        return true;
      };

      const sendPromise = client.send<{ value: number }>("test", { x: 1 });

      await new Promise<void>((r) => setTimeout(r, 5));

      const replyMsg = buildReplyMsg(capturedCorrelationId, { value: 42 });
      ch._replyHandler?.(replyMsg);

      const result = await sendPromise;
      assertEquals(result, { value: 42 });
      await client.close();
    });

    it("resolves when reply arrives via publish (exchange mode)", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({
        exchange: "my-exchange",
        routingKey: "rk",
      });
      await client.connect();

      let capturedCorrelationId = "";
      ch.publish = (_ex, _key, _buf, opts) => {
        capturedCorrelationId =
          (opts as { correlationId: string }).correlationId;
        return true;
      };

      const sendPromise = client.send<string>("event", "data");
      await new Promise<void>((r) => setTimeout(r, 5));

      ch._replyHandler?.(buildReplyMsg(capturedCorrelationId, "response"));
      const result = await sendPromise;
      assertEquals(result, "response");
      await client.close();
    });

    it("rejects when sendToQueue returns false (buffer full)", async () => {
      const ch = makeChannel({ sendToQueueReturn: false });
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();

      await assertRejects(
        () => client.send("test", {}),
        Error,
        "channel buffer full",
      );
      await client.close();
    });

    it("rejects when publish returns false (buffer full)", async () => {
      const ch = makeChannel({ publishReturn: false });
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({ exchange: "ex" });
      await client.connect();

      await assertRejects(
        () => client.send("test", {}),
        Error,
        "channel buffer full",
      );
      await client.close();
    });

    it("rejects when reply contains an err field", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();

      let capturedId = "";
      ch.sendToQueue = (_q, _buf, opts) => {
        capturedId = (opts as { correlationId: string }).correlationId;
        return true;
      };

      const sendPromise = client.send<unknown>("test", {});
      await new Promise<void>((r) => setTimeout(r, 5));

      ch._replyHandler?.(buildReplyMsg(capturedId, { err: "remote error" }));

      await assertRejects(() => sendPromise, Error, "remote error");
      await client.close();
    });

    it("rejects when reply content is not valid JSON", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();

      let capturedId = "";
      ch.sendToQueue = (_q, _buf, opts) => {
        capturedId = (opts as { correlationId: string }).correlationId;
        return true;
      };

      const sendPromise = client.send<unknown>("test", {});
      await new Promise<void>((r) => setTimeout(r, 5));

      ch._replyHandler?.({
        properties: { correlationId: capturedId },
        content: Buffer.from("not-json"),
      });

      await assertRejects(() => sendPromise, Error, "Failed to parse reply");
      await client.close();
    });

    it("handles reply with application/octet-stream contentType", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();

      let capturedId = "";
      ch.sendToQueue = (_q, _buf, opts) => {
        capturedId = (opts as { correlationId: string }).correlationId;
        return true;
      };

      const sendPromise = client.send<Uint8Array>("test", {});
      await new Promise<void>((r) => setTimeout(r, 5));

      const rawBytes = new Uint8Array([1, 2, 3]);
      ch._replyHandler?.({
        properties: {
          correlationId: capturedId,
          contentType: "application/octet-stream",
        },
        content: Buffer.from(rawBytes),
      });

      const result = await sendPromise;
      assertEquals(result instanceof Uint8Array, true);
      await client.close();
    });

    it("ignores reply with no correlationId", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();

      // Fire a reply with no correlationId - should not throw
      ch._replyHandler?.({ properties: {}, content: Buffer.from("{}") });

      await client.close();
    });

    it("ignores reply with unknown correlationId", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();

      ch._replyHandler?.(buildReplyMsg("unknown-correlation-id", {}));

      await client.close();
    });

    it("auto-connects when not yet connected", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});

      let capturedId = "";
      ch.sendToQueue = (_q, _buf, opts) => {
        capturedId = (opts as { correlationId: string }).correlationId;
        return true;
      };

      const sendPromise = client.send<string>("test", {});
      await new Promise<void>((r) => setTimeout(r, 10));
      ch._replyHandler?.(buildReplyMsg(capturedId, "ok"));

      assertEquals(await sendPromise, "ok");
      await client.close();
    });
  });

  describe("emit()", () => {
    it("sends a fire-and-forget message via sendToQueue", async () => {
      let sent = false;
      const ch = makeChannel();
      ch.sendToQueue = () => {
        sent = true;
        return true;
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();
      await client.emit("event.fired", { payload: 1 });
      await client.close();

      assertEquals(sent, true);
    });

    it("sends via publish when exchange is set", async () => {
      let published = false;
      const ch = makeChannel();
      ch.publish = () => {
        published = true;
        return true;
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({ exchange: "my-ex", routingKey: "rk" });
      await client.connect();
      await client.emit("event.fired", {});
      await client.close();

      assertEquals(published, true);
    });

    it("uses default routing key when not specified", async () => {
      let capturedKey = "none";
      const ch = makeChannel();
      ch.publish = (_ex, key, _buf, _opts) => {
        capturedKey = key;
        return true;
      };
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({ exchange: "ex" });
      await client.connect();
      await client.emit("x", {});
      await client.close();

      assertEquals(capturedKey, "");
    });
  });

  describe("onBeforeApplicationShutdown()", () => {
    it("calls close()", async () => {
      const ch = makeChannel();
      const conn = makeConnection(ch);
      using _s = stub(amqplib, "connect", () => Promise.resolve(conn as never));

      const client = new RmqClient({});
      await client.connect();
      await (client as unknown as {
        onBeforeApplicationShutdown(): Promise<void>;
      })
        .onBeforeApplicationShutdown();
    });
  });
});
