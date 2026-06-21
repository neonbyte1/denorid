import { Test } from "@denorid/core/testing";
import { Injectable } from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { spy } from "@std/testing/mock";
import { InjectStorage, StorageConnections } from "./connections.ts";
import { S3ConnectionNotFoundError } from "./exceptions.ts";
import { S3Module } from "./module.ts";
import { StorageClient } from "./storage_client.ts";

const baseConfig = {
  region: "us-east-1",
  credentials: { accessKeyId: "x", secretAccessKey: "y" },
};

function createService(
  entries: ReadonlyArray<readonly [string, StorageClient]>,
): StorageConnections {
  const service = Object.create(
    StorageConnections.prototype,
  ) as StorageConnections;

  Object.defineProperty(service, "connections", {
    value: new Map(entries),
  });

  return service;
}

describe(StorageConnections.name, () => {
  describe("get", () => {
    it("returns the default-named client when no argument is supplied", () => {
      const client = new StorageClient(baseConfig);
      const service = createService([["default", client]]);

      assertStrictEquals(service.get(), client);
    });

    it("returns named clients by their registered name", () => {
      const primary = new StorageClient(baseConfig);
      const backup = new StorageClient(baseConfig);
      const service = createService([
        ["primary", primary],
        ["backup", backup],
      ]);

      assertStrictEquals(service.get("primary"), primary);
      assertStrictEquals(service.get("backup"), backup);
    });

    it("throws S3ConnectionNotFoundError when a name is unknown", () => {
      const service = createService([
        ["primary", new StorageClient(baseConfig)],
      ]);

      const error = assertThrows(
        () => service.get("ghost"),
        S3ConnectionNotFoundError,
      );
      assertEquals(error.connectionName, "ghost");
    });

    it("throws S3ConnectionNotFoundError when the default name is not registered", () => {
      const service = createService([
        ["only-named", new StorageClient(baseConfig)],
      ]);

      const error = assertThrows(
        () => service.get(),
        S3ConnectionNotFoundError,
      );
      assertEquals(error.connectionName, "default");
    });
  });

  describe("onModuleDestroy", () => {
    it("destroys every registered client", () => {
      const a = new StorageClient(baseConfig);
      const b = new StorageClient(baseConfig);
      const destroyA = spy(a, "destroy");
      const destroyB = spy(b, "destroy");
      const service = createService([["a", a], ["b", b]]);

      try {
        service.onModuleDestroy();

        assertEquals(destroyA.calls.length, 1);
        assertEquals(destroyB.calls.length, 1);
      } finally {
        destroyA.restore();
        destroyB.restore();
      }
    });
  });

  describe("InjectStorage (end-to-end)", () => {
    it("resolves named connections through field injection", async () => {
      @Injectable()
      class Consumer {
        @InjectStorage()
        public readonly main!: StorageClient;

        @InjectStorage("backup")
        public readonly backup!: StorageClient;
      }

      const module = await Test.createTestingModule({
        providers: [Consumer],
        imports: [
          S3Module.forRoot({
            connections: [
              { name: "default", ...baseConfig },
              { name: "backup", ...baseConfig, region: "eu-central-1" },
            ],
          }),
        ],
      })
        .useCoreGlobals()
        .compile();

      try {
        const consumer = await module.get(Consumer);

        assertInstanceOf(consumer.main, StorageClient);
        assertInstanceOf(consumer.backup, StorageClient);
        assertEquals(await consumer.main.config.region(), "us-east-1");
        assertEquals(await consumer.backup.config.region(), "eu-central-1");
      } finally {
        await module.close();
      }
    });

    it("propagates S3ConnectionNotFoundError when a missing name is requested", async () => {
      @Injectable()
      class BadConsumer {
        @InjectStorage("missing")
        public readonly client!: StorageClient;
      }

      const module = await Test.createTestingModule({
        providers: [BadConsumer],
        imports: [
          S3Module.forRoot({ connection: baseConfig }),
        ],
      })
        .useCoreGlobals()
        .compile();

      try {
        let error: unknown;
        try {
          await module.get(BadConsumer);
        } catch (e) {
          error = e;
        }
        assertInstanceOf(error, S3ConnectionNotFoundError);
        assertEquals(error.connectionName, "missing");
      } finally {
        await module.close();
      }
    });
  });

  describe("module shutdown integration", () => {
    it("calls destroy on every connection when the module is closed", async () => {
      const module = await Test.createTestingModule({
        imports: [
          S3Module.forRoot({
            connections: [
              { name: "a", ...baseConfig },
              { name: "b", ...baseConfig, region: "eu-central-1" },
            ],
          }),
        ],
      })
        .useCoreGlobals()
        .compile();

      const connections = await module.get(StorageConnections);
      const destroyA = spy(connections.get("a"), "destroy");
      const destroyB = spy(connections.get("b"), "destroy");

      try {
        await module.close();

        assertEquals(destroyA.calls.length, 1);
        assertEquals(destroyB.calls.length, 1);
      } finally {
        destroyA.restore();
        destroyB.restore();
      }
    });
  });
});
