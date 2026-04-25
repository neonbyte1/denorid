import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { RmqDeserializer } from "./deserializer.ts";

describe(RmqDeserializer.name, () => {
  it("deserializes a Uint8Array containing JSON", () => {
    const d = new RmqDeserializer();
    const bytes = new TextEncoder().encode('{"x":1}');
    assertEquals(d.deserialize(bytes), { x: 1 });
  });

  it("deserializes a non-Uint8Array value via String() coercion", () => {
    const d = new RmqDeserializer();
    assertEquals(d.deserialize('{"y":2}'), { y: 2 });
  });
});
