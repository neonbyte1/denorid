import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { RmqSerializer } from "./serializer.ts";

describe(RmqSerializer.name, () => {
  it("serialize passes through Uint8Array unchanged", () => {
    const s = new RmqSerializer();
    const bytes = new Uint8Array([1, 2, 3]);
    assertEquals(Array.from(s.serialize(bytes)), [1, 2, 3]);
  });

  it("serialize encodes non-Uint8Array as JSON", () => {
    const s = new RmqSerializer();
    assertEquals(
      new TextDecoder().decode(s.serialize({ hello: "world" })),
      '{"hello":"world"}',
    );
  });

  it("contentTypeFor returns octet-stream for Uint8Array", () => {
    const s = new RmqSerializer();
    assertEquals(
      s.contentTypeFor(new Uint8Array()),
      "application/octet-stream",
    );
  });

  it("contentTypeFor returns application/json for objects", () => {
    const s = new RmqSerializer();
    assertEquals(s.contentTypeFor({ a: 1 }), "application/json");
  });

  it("contentTypeFor returns application/json for null", () => {
    const s = new RmqSerializer();
    assertEquals(s.contentTypeFor(null), "application/json");
  });
});
