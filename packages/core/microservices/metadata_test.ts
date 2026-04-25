import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { MESSAGE_PATTERN_METADATA } from "../_constants.ts";
import { getMessageMappingMetadata } from "./metadata.ts";

describe("getMessageMappingMetadata", () => {
  it("returns undefined when the class has no Symbol.metadata", () => {
    class Plain {}
    assertEquals(getMessageMappingMetadata(Plain), undefined);
  });

  it("returns undefined when Symbol.metadata exists but has no pattern key", () => {
    class Plain {}
    (Plain as unknown as { [Symbol.metadata]: object })[Symbol.metadata] = {};
    assertEquals(getMessageMappingMetadata(Plain), undefined);
  });

  it("returns the stored array when metadata has the pattern key", () => {
    class Plain {}
    (Plain as unknown as { [Symbol.metadata]: object })[Symbol.metadata] = {
      [MESSAGE_PATTERN_METADATA]: [
        { pattern: "ping", name: "ping", type: "message" },
      ],
    };

    const result = getMessageMappingMetadata(Plain);
    assertEquals(result?.length, 1);
    assertEquals(result?.[0].pattern, "ping");
    assertEquals(result?.[0].type, "message");
  });
});
