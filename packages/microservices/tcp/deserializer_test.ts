import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { TcpDeserializer } from "./deserializer.ts";
import { TcpSerializer } from "./serializer.ts";

describe("TcpDeserializer", () => {
  it("deserializes a Uint8Array produced by TcpSerializer", () => {
    const s = new TcpSerializer();
    const d = new TcpDeserializer();
    const value = { hello: "world", n: 42 };
    assertEquals(d.deserialize(s.serialize(value)), value);
  });

  it("throws TypeError for non-Uint8Array input", () => {
    assertThrows(
      () => new TcpDeserializer().deserialize("not bytes"),
      TypeError,
      "Can not deserialize type string",
    );
  });

  it("throws TypeError for number input", () => {
    assertThrows(
      () => new TcpDeserializer().deserialize(123),
      TypeError,
      "Can not deserialize type number",
    );
  });
});
