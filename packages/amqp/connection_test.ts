import { assertEquals, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import amqplib from "amqplib";
import { Buffer } from "node:buffer";
import { AMQP_MODULE_OPTIONS } from "./_constants.ts";
import { AmqpConnection } from "./connection.ts";
import type { AmqpModuleOptions } from "./module_options.ts";

interface FakeChannel {
  closed: boolean;
}

interface FakeModel {
  createChannel: () => Promise<FakeChannel>;
  close: () => Promise<void>;
  closeCalls: number;
}

function makeModel(opts: { closeThrows?: boolean } = {}): FakeModel {
  const model: FakeModel = {
    closeCalls: 0,
    createChannel: () => Promise.resolve({ closed: false }),
    close: () => {
      model.closeCalls++;

      return opts.closeThrows
        ? Promise.reject(new Error("close failed"))
        : Promise.resolve();
    },
  };

  return model;
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
      const model = makeModel();
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
      const model = makeModel();
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
      const model = makeModel();
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
      const model = makeModel();
      using _s = stub(amqplib, "connect", (url: unknown) => {
        usedUrl = url as string;

        return Promise.resolve(model as never);
      });

      const connection = makeConnection();
      await connection.connect();

      assertEquals(usedUrl, "amqp://localhost");
      await connection.close();
    });
  });

  describe("createChannel()", () => {
    it("returns a channel from the model", async () => {
      const channel = { closed: false };
      const model = makeModel();
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
      const model = makeModel();
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
      const model = makeModel({ closeThrows: true });
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
  });

  describe("onBeforeApplicationShutdown()", () => {
    it("closes the connection", async () => {
      const model = makeModel();
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(model as never),
      );

      const connection = makeConnection();
      await connection.connect();
      await connection.onBeforeApplicationShutdown();

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
