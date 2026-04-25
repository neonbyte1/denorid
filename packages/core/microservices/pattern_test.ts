import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
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

  it("serialises an empty object", () => {
    assertEquals(serializePattern({}), "{}");
  });

  it("serialises a single-key object", () => {
    assertEquals(serializePattern({ x: 99 }), '{"x":99}');
  });
});
