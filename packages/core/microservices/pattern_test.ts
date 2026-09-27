import { assertEquals } from "@std/assert";
import { describe, it } from "node:test";
import { serializePattern } from "./pattern.ts";

describe("serializePattern", () => {
  it("returns string patterns unchanged", () => {
    assertEquals(serializePattern("ping"), "ping");
    assertEquals(serializePattern(""), "");
  });

  it("serialises an object pattern to sorted JSON", () => {
    assertEquals(
      serializePattern({ cmd: "find", entity: "user" }),
      '{"cmd":"find","entity":"user"}',
    );
  });

  it("sorts object keys so insertion order does not matter", () => {
    assertEquals(
      serializePattern({ z: 1, a: 2 }),
      serializePattern({ a: 2, z: 1 }),
    );
  });

  it("sorts the keys of nested objects, also inside arrays", () => {
    const server = serializePattern({
      cmd: "user",
      filter: { role: "admin", active: true },
      sort: [{ field: "name", dir: "asc" }],
    });
    const client = serializePattern({
      sort: [{ dir: "asc", field: "name" }],
      filter: { active: true, role: "admin" },
      cmd: "user",
    });

    assertEquals(server, client);
    assertEquals(
      server,
      '{"cmd":"user","filter":{"active":true,"role":"admin"},"sort":[{"dir":"asc","field":"name"}]}',
    );
  });

  it("keeps the order of array items", () => {
    assertEquals(
      serializePattern({ path: ["b", "a", null] }),
      '{"path":["b","a",null]}',
    );
  });

  it("serialises an empty object", () => {
    assertEquals(serializePattern({}), "{}");
  });

  it("serialises a single-key object", () => {
    assertEquals(serializePattern({ x: 99 }), '{"x":99}');
  });
});
