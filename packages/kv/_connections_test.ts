import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createConnectionMap } from "./_connections.ts";

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
      const result = createConnectionMap({
        connections: [
          { name: "primary", path: "/tmp/primary.db", queue: true },
          { name: "secondary", path: "/tmp/secondary.db", queue: false },
          { name: "tertiary", path: "/tmp/tertiary.db" },
        ],
      });

      assertEquals(result.size, 3);
      assertEquals(result.get("primary"), {
        path: "/tmp/primary.db",
        queue: true,
      });
      assertEquals(result.get("secondary"), {
        path: "/tmp/secondary.db",
        queue: false,
      });
      assertEquals(result.get("tertiary"), { path: "/tmp/tertiary.db" });
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
