import { Test } from "@denorid/core/testing";
import { Module } from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { KvConnections } from "./connections.ts";
import { KvModule } from "./module.ts";
import { KvQueue } from "./queue/mod.ts";

function createKv(): Deno.Kv {
  return { close: () => {} } as unknown as Deno.Kv;
}

describe(KvModule.name, () => {
  it("forRoot registers options and connects during module initialization", async () => {
    const openedKv = createKv();
    const opened: Array<string | undefined> = [];
    const openKvStub = stub(Deno, "openKv", (path?: string) => {
      opened.push(path);

      return Promise.resolve(openedKv);
    });
    const module = await Test.createTestingModule({
      imports: [
        KvModule.forRoot({
          connection: { path: "/tmp/for-root.db", queue: true },
        }),
      ],
    })
      .useCoreGlobals()
      .compile();

    try {
      const connections = await module.get(KvConnections);
      const entry = connections.connections.get("default");

      assertEquals(opened, ["/tmp/for-root.db"]);
      assertEquals(entry?.path, "/tmp/for-root.db");
      assertEquals(entry?.queue, true);
      assertStrictEquals(entry?.kv, openedKv);
    } finally {
      await module.close();
      openKvStub.restore();
    }
  });

  it("forRootAsync injects imported dependencies and awaits factory results", async () => {
    const CONFIG = Symbol("CONFIG");
    const openedKv = createKv();
    const opened: Array<string | undefined> = [];

    @Module({
      providers: [{ provide: CONFIG, useValue: "/tmp/async.db" }],
      exports: [CONFIG],
    })
    class ConfigModule {}

    const openKvStub = stub(Deno, "openKv", (path?: string) => {
      opened.push(path);

      return Promise.resolve(openedKv);
    });
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
      const entry = connections.connections.get("default");

      assertEquals(opened, ["/tmp/async.db"]);
      assertEquals(entry, {
        path: "/tmp/async.db",
        queue: false,
        kv: openedKv,
      });
    } finally {
      await module.close();
      openKvStub.restore();
    }
  });

  it("exports connections and queue providers from a compiled testing module", async () => {
    const openKvStub = stub(Deno, "openKv", () => Promise.resolve(createKv()));
    const module = await Test.createTestingModule({
      imports: [KvModule.forRoot({ connection: "/tmp/exported.db" })],
    })
      .useCoreGlobals()
      .compile();

    try {
      assertInstanceOf(await module.get(KvConnections), KvConnections);
      assertInstanceOf(await module.get(KvQueue), KvQueue);
    } finally {
      await module.close();
      openKvStub.restore();
    }
  });
});
