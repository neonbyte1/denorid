import { Logger } from "@denorid/logger";
import {
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import amqplib from "amqplib";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { AMQP_MODULE_OPTIONS } from "./_constants.ts";
import { AmqpConnection } from "./connection.ts";
import type { AmqpModuleOptions } from "./module_options.ts";

class FakeChannel extends EventEmitter {}

class FakeModel extends EventEmitter {
  public closeCalls = 0;

  public constructor(private readonly closeThrows = false) {
    super();
  }

  public createChannel(): Promise<FakeChannel> {
    return Promise.resolve(new FakeChannel());
  }

  public close(): Promise<void> {
    this.closeCalls++;

    if (this.closeThrows) {
      return Promise.reject(new Error("close failed"));
    }

    this.emit("close");

    return Promise.resolve();
  }
}

function makeConnection(options: AmqpModuleOptions = {}): AmqpConnection {
  const connection = new AmqpConnection();

  Object.defineProperty(connection, "options", {
    value: { [AMQP_MODULE_OPTIONS]: undefined, ...options },
  });

  return connection;
}

describe(AmqpConnection.name, () => {
  describe("connect()", () => {
    it("calls amqplib.connect once across concurrent calls", async () => {
      let calls = 0;
      const model = new FakeModel();
      using _s = stub(amqplib, "connect", () => {
        calls++;

        return Promise.resolve(model as never);
      });

      const connection = makeConnection();
      const [a, b] = await Promise.all([
        connection.connect(),
        connection.connect(),
      ]);

      assertEquals(calls, 1);
      assertStrictEquals(a, b);
      await connection.close();
    });

    it("returns the cached model on a subsequent call", async () => {
      let calls = 0;
      const model = new FakeModel();
      using _s = stub(amqplib, "connect", () => {
        calls++;

        return Promise.resolve(model as never);
      });

      const connection = makeConnection();
      await connection.connect();
      await connection.connect();

      assertEquals(calls, 1);
      await connection.close();
    });

    it("uses the configured url", async () => {
      let usedUrl = "";
      const model = new FakeModel();
      using _s = stub(amqplib, "connect", (url: unknown) => {
        usedUrl = url as string;

        return Promise.resolve(model as never);
      });

      const connection = makeConnection({ url: "amqp://broker:5672" });
      await connection.connect();

      assertEquals(usedUrl, "amqp://broker:5672");
      await connection.close();
    });

    it("defaults the url to amqp://localhost", async () => {
      let usedUrl = "";
      const model = new FakeModel();
      using _s = stub(amqplib, "connect", (url: unknown) => {
        usedUrl = url as string;

        return Promise.resolve(model as never);
      });

      const connection = makeConnection();
      await connection.connect();

      assertEquals(usedUrl, "amqp://localhost");
      await connection.close();
    });

    it("retries on the next call after a failed connect", async () => {
      const model = new FakeModel();
      let calls = 0;
      using _s = stub(amqplib, "connect", () => {
        calls++;

        return calls === 1
          ? Promise.reject(new Error("ECONNREFUSED"))
          : Promise.resolve(model as never);
      });

      const connection = makeConnection();

      await assertRejects(() => connection.connect(), Error, "ECONNREFUSED");
      assertStrictEquals(await connection.connect(), model as never);
      await connection.close();
    });
  });

  describe("broker failures", () => {
    it("logs connection errors instead of crashing the process", async () => {
      using logError = stub(Logger.prototype, "error");
      const model = new FakeModel();
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(model as never),
      );

      const connection = makeConnection();
      await connection.connect();

      // Without a listener EventEmitter#emit("error") throws.
      model.emit("error", new Error("Unexpected close"));

      assertSpyCalls(logError, 1);
      await connection.close();
    });

    it("reconnects on the next call once the connection closed", async () => {
      const first = new FakeModel();
      const second = new FakeModel();
      const models = [first, second];
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(models.shift() as never),
      );

      const connection = makeConnection();
      await connection.connect();

      first.emit("close", new Error("Unexpected close"));

      assertStrictEquals(await connection.connect(), second as never);
      await connection.close();
      assertEquals(second.closeCalls, 1);
    });

    it("logs channel errors instead of crashing the process", async () => {
      using logError = stub(Logger.prototype, "error");
      const model = new FakeModel();
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(model as never),
      );

      const connection = makeConnection();
      const channel = await connection.createChannel();

      channel.emit("error", new Error("Channel closed by server: 406"));

      assertSpyCalls(logError, 1);
      await connection.close();
    });
  });

  describe("createChannel()", () => {
    it("returns a channel from the model", async () => {
      const channel = new FakeChannel();
      const model = new FakeModel();
      model.createChannel = () => Promise.resolve(channel);
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(model as never),
      );

      const connection = makeConnection();
      const result = await connection.createChannel();

      assertStrictEquals(result as unknown, channel);
      await connection.close();
    });
  });

  describe("close()", () => {
    it("closes the model and is a no-op the second time", async () => {
      const model = new FakeModel();
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(model as never),
      );

      const connection = makeConnection();
      await connection.connect();
      await connection.close();
      await connection.close();

      assertEquals(model.closeCalls, 1);
    });

    it("swallows a throwing model.close()", async () => {
      const model = new FakeModel(true);
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(model as never),
      );

      const connection = makeConnection();
      await connection.connect();
      await connection.close();

      assertEquals(model.closeCalls, 1);
    });

    it("is safe to call when never connected", async () => {
      const connection = makeConnection();
      await connection.close();
    });

    it("closes a connection that completes after close() was called", async () => {
      const late = new FakeModel();
      const connected = Promise.withResolvers<FakeModel>();
      using _s = stub(
        amqplib,
        "connect",
        () => connected.promise as never,
      );

      const connection = makeConnection();
      const connecting = connection.connect();
      const closing = connection.close();

      connected.resolve(late);

      await assertRejects(
        () => connecting,
        Error,
        "AMQP connection closed while connecting",
      );
      await closing;
      assertEquals(late.closeCalls, 1);
    });

    it("swallows a failing close of a connection that completed late", async () => {
      const late = new FakeModel(true);
      const connected = Promise.withResolvers<FakeModel>();
      using _s = stub(
        amqplib,
        "connect",
        () => connected.promise as never,
      );

      const connection = makeConnection();
      const connecting = connection.connect().catch((err: Error) => err);
      const closing = connection.close();

      connected.resolve(late);
      await closing;

      assertEquals(
        (await connecting as Error).message,
        "AMQP connection closed while connecting",
      );
      assertEquals(late.closeCalls, 1);
    });

    it("connects again after close()", async () => {
      const first = new FakeModel();
      const second = new FakeModel();
      const models = [first, second];
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(models.shift() as never),
      );

      const connection = makeConnection();
      await connection.connect();
      await connection.close();

      const reconnected = await connection.connect();

      assertNotStrictEquals(reconnected, first as never);
      await connection.close();
    });
  });

  describe("[Symbol.asyncDispose]()", () => {
    it("closes the connection when disposed", async () => {
      const model = new FakeModel();
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(model as never),
      );

      {
        await using connection = makeConnection();
        await connection.connect();
      }

      assertEquals(model.closeCalls, 1);
    });
  });

  describe("serializer", () => {
    it("falls back to the default JSON serializer when not injected", () => {
      const connection = makeConnection();
      const encoded = connection.serializer.serialize({ a: 1 });

      assertEquals(connection.serializer.deserialize(encoded), { a: 1 });
    });

    it("returns the injected serializer when present", () => {
      const custom = {
        serialize: () => Buffer.from(""),
        deserialize: () => "custom",
      };
      const connection = makeConnection();
      Object.defineProperty(connection, "_serializer", {
        value: custom,
      });

      assertStrictEquals(connection.serializer, custom);
    });
  });
});
