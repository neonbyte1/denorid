import { assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { TcpSerializer } from "./serializer.ts";

describe("TcpSerializer", () => {
  it("serialize returns a Uint8Array", () => {
    const s = new TcpSerializer();
    assertInstanceOf(s.serialize({ hello: "world" }), Uint8Array);
  });
});
