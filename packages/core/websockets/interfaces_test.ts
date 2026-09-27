import { assertEquals } from "@std/assert";
import { describe, it } from "node:test";
import { isWsResponse } from "./interfaces.ts";

describe(isWsResponse.name, () => {
  it("accepts objects with a string event and a data key", () => {
    assertEquals(isWsResponse({ event: "message", data: undefined }), true);
  });

  it("rejects everything else", () => {
    for (
      const value of [
        undefined,
        null,
        "message",
        { event: "message" },
        { event: 1, data: 1 },
      ]
    ) {
      assertEquals(isWsResponse(value), false);
    }
  });
});
