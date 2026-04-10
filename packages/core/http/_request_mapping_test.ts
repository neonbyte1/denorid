import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { getRequestMappingMetadata } from "./_request_mapping.ts";

describe(getRequestMappingMetadata.name, () => {
  it("ensure it references the metadata field from a decorator context", () => {
    const ctx = {
      kind: "class",
      name: "",
      metadata: {},
      addInitializer: (_: unknown): void => {},
    } satisfies ClassDecoratorContext;

    const created = getRequestMappingMetadata(ctx);
    const cached = getRequestMappingMetadata(ctx);

    assertEquals(cached, created);
  });

  it("returns undefined for undecorated classes", () => {
    class ExampleClass {}

    assertEquals(getRequestMappingMetadata(ExampleClass), undefined);
  });

  it("ensure it references the metadata field using the global metadata symbol", () => {
    class ExampleClass {}

    ExampleClass[Symbol.metadata] = {};

    const created = getRequestMappingMetadata(ExampleClass);
    const cached = getRequestMappingMetadata(ExampleClass);

    assertEquals(cached, created);
  });
});
