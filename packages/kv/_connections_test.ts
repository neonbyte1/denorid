import type { Kv } from "@deno/kv";
import {
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { spy } from "@std/testing/mock";
import { describe, it } from "node:test";
import {
  createConnectionMap,
  type KvRuntimeScope,
  openKv,
} from "./_connections.ts";

describe(createConnectionMap.name, () => {
  describe("single-connection options (KvConnectionOptions)", () => {
    it("should create a map with a single 'default' entry", () => {
      const result = createConnectionMap({ connection: "/tmp/my.db" });

      assertEquals(result.size, 1);
      assertEquals(result.get("default"), { path: "/tmp/my.db" });
    });

    it("should create a default entry from object connection options", () => {
      const result = createConnectionMap({
        connection: { path: "/tmp/object.db", queue: true },
      });

      assertEquals(result.size, 1);
      assertEquals(result.get("default"), {
        path: "/tmp/object.db",
        queue: true,
      });
    });

    it("should keep the open options of object connection options", () => {
      const openOptions = { implementation: "in-memory" } as const;
      const result = createConnectionMap({
        connection: { path: "", openOptions },
      });

      assertEquals(result.size, 1);
      assertEquals(result.get("default"), { path: "", openOptions });
      assertStrictEquals(result.get("default")?.openOptions, openOptions);
    });

    it("should preserve explicit false top-level queue option", () => {
      const result = createConnectionMap({
        connection: "/tmp/not-queued.db",
        queue: false,
      });

      assertEquals(result.size, 1);
      assertEquals(result.get("default"), {
        path: "/tmp/not-queued.db",
        queue: false,
      });
    });

    it("should preserve explicit false object queue option", () => {
      const result = createConnectionMap({
        connection: { path: "/tmp/object-not-queued.db", queue: false },
      });

      assertEquals(result.size, 1);
      assertEquals(result.get("default"), {
        path: "/tmp/object-not-queued.db",
        queue: false,
      });
    });

    it("should apply the top-level queue option to string connection options", () => {
      const result = createConnectionMap({
        connection: "/tmp/queued.db",
        queue: true,
      });

      assertEquals(result.size, 1);
      assertEquals(result.get("default"), {
        path: "/tmp/queued.db",
        queue: true,
      });
    });
  });

  describe("multi-connection options (KvConnectionsOptions)", () => {
    it("should create an entry per connection", () => {
      const openOptions = { debug: false };
      const result = createConnectionMap({
        connections: [
          { name: "primary", path: "/tmp/primary.db", queue: true },
          { name: "secondary", path: "/tmp/secondary.db", queue: false },
          { name: "tertiary", path: "/tmp/tertiary.db" },
          { name: "quaternary", path: "/tmp/quaternary.db", openOptions },
        ],
      });

      assertEquals(result.size, 4);
      assertEquals(result.get("primary"), {
        path: "/tmp/primary.db",
        queue: true,
      });
      assertEquals(result.get("secondary"), {
        path: "/tmp/secondary.db",
        queue: false,
      });
      assertEquals(result.get("tertiary"), { path: "/tmp/tertiary.db" });
      assertEquals(result.get("quaternary"), {
        path: "/tmp/quaternary.db",
        openOptions,
      });
    });

    it("should handle a single connection in the connections array", () => {
      const result = createConnectionMap({
        connections: [{ name: "only", path: "/tmp/only.db" }],
      });

      assertEquals(result.size, 1);
      assertEquals(result.get("only"), { path: "/tmp/only.db" });
    });

    it("should handle an empty connections array", () => {
      const result = createConnectionMap({ connections: [] });

      assertEquals(result.size, 0);
    });

    it("should let later duplicate connection names overwrite earlier ones", () => {
      const result = createConnectionMap({
        connections: [
          { name: "duplicate", path: "/tmp/first.db", queue: true },
          { name: "duplicate", path: "/tmp/second.db", queue: false },
        ],
      });

      assertEquals(result.size, 1);
      assertEquals(result.get("duplicate"), {
        path: "/tmp/second.db",
        queue: false,
      });
    });
  });
});

describe(openKv.name, () => {
  it("opens the store through the native Deno.openKv of the global scope by default", async () => {
    const kv = await openKv(":memory:");

    try {
      assertInstanceOf(kv, Deno.Kv);
    } finally {
      kv.close();
    }
  });

  it("uses the native openKv with the path only when the scope provides it", async () => {
    const kv = { close: () => {} } as unknown as Kv;
    const nativeOpenKv = spy((_path: string) => Promise.resolve(kv));
    const scope: KvRuntimeScope = { Deno: { openKv: nativeOpenKv } };

    const result = await openKv(
      "/tmp/native.db",
      { implementation: "in-memory" },
      scope,
    );

    assertStrictEquals(result, kv);
    assertEquals(nativeOpenKv.calls.length, 1);
    assertEquals(nativeOpenKv.calls[0].args, ["/tmp/native.db"]);
  });

  it("propagates native open failures", async () => {
    const failure = new Error("open failed");
    const scope: KvRuntimeScope = {
      Deno: { openKv: () => Promise.reject(failure) },
    };

    const error = await assertRejects(() =>
      openKv("/tmp/native.db", {}, scope)
    );

    assertStrictEquals(error, failure);
  });

  for (
    const [runtime, scope] of [
      ["Node.js and Bun (no Deno global)", {}],
      ["Deno without the unstable KV API", { Deno: {} }],
    ] as const
  ) {
    it(`falls back to @deno/kv with the open options on ${runtime}`, async () => {
      const kv = await openKv(
        ":memory:",
        { implementation: "in-memory" },
        scope,
      );
      const received = Promise.withResolvers<unknown>();
      const listening = kv.listenQueue((message: unknown) => {
        received.resolve(message);
      });

      try {
        assertFalse(kv instanceof Deno.Kv);

        await kv.set(["key"], { value: 1 });
        assertEquals((await kv.get(["key"])).value, { value: 1 });

        await kv.enqueue({ id: "event" });
        assertEquals(await received.promise, { id: "event" });
      } finally {
        kv.close();
        await listening;
      }
    });
  }
});
