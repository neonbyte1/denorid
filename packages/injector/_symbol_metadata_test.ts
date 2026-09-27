import { assertEquals, assertStrictEquals } from "@std/assert";
import { describe, it } from "node:test";
import {
  installSymbolMetadata,
  type SymbolMetadataHost,
} from "./_symbol_metadata.ts";

describe("installSymbolMetadata", () => {
  it("installs the registered Symbol.metadata key when missing", () => {
    const host: SymbolMetadataHost = {};

    installSymbolMetadata(host);

    assertStrictEquals(host.metadata, Symbol.for("Symbol.metadata"));
  });

  it("keeps a native Symbol.metadata untouched", () => {
    const native = Symbol("Symbol.metadata");
    const host: SymbolMetadataHost = { metadata: native };

    installSymbolMetadata(host);

    assertStrictEquals(host.metadata, native);
  });

  it("exposes Symbol.metadata on the global Symbol after import", () => {
    assertEquals(typeof Symbol.metadata, "symbol");
  });
});
