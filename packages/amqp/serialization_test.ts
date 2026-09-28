import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { encode } from "@std/msgpack";
import type { MessageProperties } from "amqplib";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import { AMQP_SERIALIZER } from "./_constants.ts";
import {
  AMQP_SERIALIZER as ExportedToken,
  type AmqpSerializer,
  JsonAmqpSerializer,
  MsgpackAmqpSerializer,
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

    it("encodes values JSON cannot represent (a void result) as null", () => {
      assertEquals(
        serializer.deserialize(serializer.serialize(undefined)),
        null,
      );
      assertEquals(
        serializer.deserialize(serializer.serialize(() => {})),
        null,
      );
    });

    it("round-trips a Uint8Array through its content type", () => {
      // Bytes that happen to be valid JSON must still come back verbatim.
      const bytes = new TextEncoder().encode("123");
      const encoded = serializer.serialize(bytes);
      const contentType = serializer.contentType!(bytes);

      assertEquals(contentType, "application/octet-stream");
      assertEquals(
        serializer.deserialize(encoded, { contentType } as MessageProperties),
        encoded,
      );
    });

    it("tags every other value as JSON", () => {
      const contentType = serializer.contentType!({ a: 1 });

      assertEquals(contentType, "application/json");
      assertEquals(
        serializer.deserialize(Buffer.from("[1]"), {
          contentType,
        } as MessageProperties),
        [1],
      );
    });
  });

  describe(MsgpackAmqpSerializer.name, () => {
    const serializer: AmqpSerializer = new MsgpackAmqpSerializer();

    it("round-trips bigint and nested bytes, tagged application/vnd.msgpack", () => {
      const value = {
        id: 2n ** 63n,
        avatar: new Uint8Array([0, 255]),
        tags: ["a", 1, null, true],
      };
      const encoded = serializer.serialize(value);
      const contentType = serializer.contentType!(value);

      assertInstanceOf(encoded, Buffer);
      assertEquals(contentType, "application/vnd.msgpack");

      // Untagged bodies are MessagePack for this serializer.
      for (
        const decoded of [
          serializer.deserialize(encoded, { contentType } as MessageProperties),
          serializer.deserialize(encoded),
        ] as (typeof value)[]
      ) {
        // Nested bytes come back as views into the received body.
        assertInstanceOf(decoded.avatar, Uint8Array);
        assertEquals(
          { ...decoded, avatar: new Uint8Array(decoded.avatar) },
          value,
        );
      }
    });

    it("encodes a void result as null", () => {
      assertEquals(
        serializer.deserialize(serializer.serialize(undefined)),
        null,
      );
    });

    it("round-trips a Uint8Array verbatim through its content type", () => {
      const bytes = new Uint8Array([0x93, 1, 2, 3]);
      const encoded = serializer.serialize(bytes);
      const contentType = serializer.contentType!(bytes);

      assertEquals(contentType, "application/octet-stream");
      assertEquals(new Uint8Array(encoded), bytes);
      assertEquals(
        serializer.deserialize(encoded, { contentType } as MessageProperties),
        encoded,
      );
    });

    it("throws on values MessagePack cannot represent", () => {
      assertThrows(() => serializer.serialize({ at: new Date(0) }));
      assertThrows(() => serializer.serialize({ missing: undefined }));
    });
  });

  describe("content type decoding", () => {
    const value = { id: 7, name: "a" };
    const json = Buffer.from(JSON.stringify(value));
    const msgpack = encode(value);

    for (
      const serializer of [
        new JsonAmqpSerializer(),
        new MsgpackAmqpSerializer(),
      ]
    ) {
      it(`${serializer.constructor.name} decodes JSON and MessagePack bodies by their tag`, () => {
        const read = (content: Uint8Array, contentType: string): unknown =>
          serializer.deserialize(content, { contentType } as MessageProperties);

        assertEquals(read(json, "application/json; charset=utf-8"), value);
        assertEquals(read(msgpack, "application/vnd.msgpack"), value);
        assertEquals(read(msgpack, "Application/MsgPack"), value);
        assertEquals(read(msgpack, "application/x-msgpack"), value);
      });
    }
  });
});
