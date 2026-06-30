import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { Buffer } from "node:buffer";
import { AMQP_SERIALIZER } from "./_constants.ts";
import {
  AMQP_SERIALIZER as ExportedToken,
  type AmqpSerializer,
  JsonAmqpSerializer,
} from "./serialization.ts";

describe("serialization", () => {
  it("re-exports the AMQP_SERIALIZER token from the module barrel", () => {
    assertEquals(ExportedToken, AMQP_SERIALIZER);
  });

  describe(JsonAmqpSerializer.name, () => {
    const serializer: AmqpSerializer = new JsonAmqpSerializer();

    it("round-trips an object", () => {
      const value = { id: 1, name: "a", nested: { ok: true } };
      const encoded = serializer.serialize(value);

      assertInstanceOf(encoded, Buffer);
      assertEquals(serializer.deserialize(encoded), value);
    });

    it("round-trips an array", () => {
      const value = [1, "two", { three: 3 }];

      assertEquals(serializer.deserialize(serializer.serialize(value)), value);
    });

    it("round-trips a string", () => {
      assertEquals(serializer.deserialize(serializer.serialize("hi")), "hi");
    });

    it("round-trips a number", () => {
      assertEquals(serializer.deserialize(serializer.serialize(42)), 42);
    });

    it("passes a Uint8Array through unchanged on serialize", () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const encoded = serializer.serialize(bytes);

      assertInstanceOf(encoded, Buffer);
      assertEquals(new Uint8Array(encoded), bytes);
    });

    it("deserializes a Uint8Array containing JSON", () => {
      const bytes = new TextEncoder().encode(JSON.stringify([true, null]));

      assertEquals(serializer.deserialize(bytes), [true, null]);
    });
  });
});
