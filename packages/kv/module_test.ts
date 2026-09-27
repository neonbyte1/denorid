import type { Kv } from "@deno/kv";
import { Test } from "@denorid/core/testing";
import {
  Injectable,
  Module,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from "@denorid/injector";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertThrows,
} from "@std/assert";
import { describe, it } from "node:test";
import { InjectKv, KvConnections } from "./connections.ts";
import { ConnectionNotEstablishedException } from "./exceptions.ts";
import { KvModule } from "./module.ts";
import { KvQueue } from "./queue/mod.ts";

describe(KvModule.name, () => {
  it("forRoot registers options and connects during module initialization", async () => {
    const openOptions = { debug: false };
    const module = await Test.createTestingModule({
      imports: [
        KvModule.forRoot({
          connection: { path: ":memory:", queue: true, openOptions },
        }),
      ],
    })
      .useCoreGlobals()
      .compile();

    try {
      const connections = await module.get(KvConnections);
      const entry = connections.connections.get("default");

      assertEquals(entry?.path, ":memory:");
      assertEquals(entry?.queue, true);
      assertEquals(entry?.openOptions, openOptions);
      assertExists(entry?.kv);
      await connections.get().set(["key"], "value");
      assertEquals((await connections.get().get(["key"])).value, "value");
    } finally {
      await module.close();
    }
  });

  it("forRootAsync injects imported dependencies and awaits factory results", async () => {
    const CONFIG = Symbol("CONFIG");

    @Module({
      providers: [{ provide: CONFIG, useValue: ":memory:" }],
      exports: [CONFIG],
    })
    class ConfigModule {}

    const module = await Test.createTestingModule({
      imports: [
        KvModule.forRootAsync({
          imports: [ConfigModule],
          inject: [CONFIG],
          useFactory: (path: string) =>
            Promise.resolve({
              connection: path,
              queue: false,
            }),
        }),
      ],
    })
      .useCoreGlobals()
      .compile();

    try {
      const connections = await module.get(KvConnections);
      const { kv, ...entry } = connections.connections.get("default") ?? {};

      assertEquals(entry, { path: ":memory:", queue: false });
      assertExists(kv);
    } finally {
      await module.close();
    }
  });

  it("exports connections and queue providers from a compiled testing module", async () => {
    const module = await Test.createTestingModule({
      imports: [KvModule.forRoot({ connection: ":memory:" })],
    })
      .useCoreGlobals()
      .compile();

    try {
      assertInstanceOf(await module.get(KvConnections), KvConnections);
      assertInstanceOf(await module.get(KvQueue), KvQueue);
    } finally {
      await module.close();
    }
  });

  it("keeps the stores open for shutdown hooks and closes them afterwards", async () => {
    @Injectable()
    class Flusher implements OnModuleDestroy, OnApplicationShutdown {
      @InjectKv()
      public readonly kv!: Kv;

      public flushed: unknown;

      public async onModuleDestroy(): Promise<void> {
        await this.kv.set(["flushed"], true);
      }

      public async onApplicationShutdown(): Promise<void> {
        this.flushed = (await this.kv.get(["flushed"])).value;
      }
    }

    const module = await Test.createTestingModule({
      imports: [
        KvModule.forRoot({ connection: { path: ":memory:", queue: true } }),
      ],
      providers: [Flusher],
    })
      .useCoreGlobals()
      .compile();

    await module.init();

    const flusher = await module.get(Flusher);
    const connections = await module.get(KvConnections);

    await module.close();

    assertEquals(flusher.flushed, true);
    assertThrows(() => connections.get(), ConnectionNotEstablishedException);
  });
});
