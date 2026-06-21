import { Test } from "@denorid/core/testing";
import type {
  BaseProvider,
  FactoryProvider,
  ValueProvider,
} from "@denorid/injector";
import { Injectable, Module, type Type } from "@denorid/injector";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertNotStrictEquals,
  assertStrictEquals,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { S3_MODULE_OPTIONS } from "./_constants.ts";
import { InjectStorage, StorageConnections } from "./connections.ts";
import { S3Module } from "./module.ts";
import { StorageClient } from "./storage_client.ts";

const baseConfig = {
  region: "us-east-1",
  credentials: { accessKeyId: "x", secretAccessKey: "y" },
};

describe(S3Module.name, () => {
  describe("forRoot", () => {
    it("registers the options value provider and exposes StorageConnections", () => {
      const options = { connection: baseConfig };
      const mod = S3Module.forRoot(options);

      assertEquals(mod.module, S3Module);
      assertEquals(mod.global, undefined);
      assertEquals(mod.imports, []);

      const optionsProvider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === S3_MODULE_OPTIONS,
      );
      assertExists(optionsProvider);
      assertStrictEquals(
        (optionsProvider as ValueProvider).useValue,
        options,
      );

      // StorageConnections + InjectStorage are wired through the @Module()
      // metadata of S3Module itself, not the dynamic providers list.
      assertEquals(mod.providers!.length, 1);
    });

    it("propagates the global flag", () => {
      const mod = S3Module.forRoot({ connection: baseConfig, global: true });

      assertEquals(mod.global, true);
    });

    it("accepts a multi-connection options shape", () => {
      const mod = S3Module.forRoot({
        connections: [
          { name: "a", ...baseConfig },
          { name: "b", ...baseConfig, region: "eu-central-1" },
        ],
      });

      assertEquals(mod.module, S3Module);
    });
  });

  describe("forRootAsync", () => {
    it("registers a factory provider with the supplied useFactory and inject", () => {
      const TOKEN = Symbol("TOKEN");
      const useFactory = () => ({ connection: baseConfig });
      const mod = S3Module.forRootAsync({
        useFactory,
        inject: [TOKEN],
      });

      const optionsProvider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === S3_MODULE_OPTIONS,
      ) as FactoryProvider;

      assertStrictEquals(optionsProvider.useFactory, useFactory);
      assertEquals(optionsProvider.inject, [TOKEN]);
    });

    it("flows imports, extraProviders, and global through", () => {
      const TOKEN = Symbol("TOKEN");
      const fakeImport = class {} as Type;
      const extra: ValueProvider = { provide: "EXTRA", useValue: 42 };
      const mod = S3Module.forRootAsync({
        global: true,
        imports: [fakeImport],
        inject: [TOKEN],
        useFactory: () => ({ connection: baseConfig }),
        extraProviders: [extra],
      });

      assertEquals(mod.global, true);
      assertEquals(mod.imports, [fakeImport]);
      assertEquals(mod.providers!.includes(extra), true);
    });
  });

  describe("end-to-end", () => {
    it("compiles a single-connection module and resolves the default StorageClient", async () => {
      const module = await Test.createTestingModule({
        imports: [S3Module.forRoot({ connection: baseConfig })],
      })
        .useCoreGlobals()
        .compile();

      try {
        const connections = await module.get(StorageConnections);
        const client = connections.get();

        assertInstanceOf(client, StorageClient);
        assertEquals(await client.config.region(), "us-east-1");
        assertEquals([...connections.connections.keys()], ["default"]);
      } finally {
        await module.close();
      }
    });

    it("compiles a multi-connection module and exposes every named client", async () => {
      const module = await Test.createTestingModule({
        imports: [
          S3Module.forRoot({
            connections: [
              { name: "primary", ...baseConfig },
              { name: "backup", ...baseConfig, region: "eu-central-1" },
            ],
          }),
        ],
      })
        .useCoreGlobals()
        .compile();

      try {
        const connections = await module.get(StorageConnections);

        const primary = connections.get("primary");
        const backup = connections.get("backup");

        assertInstanceOf(primary, StorageClient);
        assertInstanceOf(backup, StorageClient);
        assertNotStrictEquals(primary, backup);
        assertEquals(await primary.config.region(), "us-east-1");
        assertEquals(await backup.config.region(), "eu-central-1");
        assertEquals(
          [...connections.connections.keys()].sort(),
          ["backup", "primary"],
        );
      } finally {
        await module.close();
      }
    });

    it("compiles a forRootAsync module and serves the resolved connections", async () => {
      const REGION = Symbol("REGION");

      @Module({
        providers: [{ provide: REGION, useValue: "eu-central-1" }],
        exports: [REGION],
      })
      class RegionModule {}

      const module = await Test.createTestingModule({
        imports: [
          S3Module.forRootAsync({
            imports: [RegionModule],
            inject: [REGION],
            useFactory: (region: string) =>
              Promise.resolve({
                connections: [
                  { name: "default", ...baseConfig },
                  { name: "secondary", ...baseConfig, region },
                ],
              }),
          }),
        ],
      })
        .useCoreGlobals()
        .compile();

      try {
        const connections = await module.get(StorageConnections);

        assertEquals(
          await connections.get().config.region(),
          "us-east-1",
        );
        assertEquals(
          await connections.get("secondary").config.region(),
          "eu-central-1",
        );
      } finally {
        await module.close();
      }
    });

    it("InjectStorage resolves the same client as StorageConnections.get for each name", async () => {
      @Injectable()
      class Consumer {
        @InjectStorage()
        public readonly main!: StorageClient;

        @InjectStorage("archive")
        public readonly archive!: StorageClient;
      }

      const module = await Test.createTestingModule({
        providers: [Consumer],
        imports: [
          S3Module.forRoot({
            connections: [
              { name: "default", ...baseConfig },
              { name: "archive", ...baseConfig, region: "eu-central-1" },
            ],
          }),
        ],
      })
        .useCoreGlobals()
        .compile();

      try {
        const connections = await module.get(StorageConnections);
        const consumer = await module.get(Consumer);

        assertStrictEquals(consumer.main, connections.get());
        assertStrictEquals(consumer.archive, connections.get("archive"));
        assertNotStrictEquals(consumer.main, consumer.archive);
      } finally {
        await module.close();
      }
    });
  });
});
