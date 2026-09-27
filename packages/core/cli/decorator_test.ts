import { assertEquals } from "@std/assert";
import { describe, it } from "node:test";
import { CLI_OPTIONS_METADATA } from "../_constants.ts";
import { Option } from "./decorator.ts";

describe(Option.name, () => {
  it("copies inherited options instead of changing the parent class", () => {
    const parent = {
      [CLI_OPTIONS_METADATA]: [{ name: "a" }],
    };
    // Spec compliant runtimes link the metadata of a subclass to the parent's.
    const metadata = Object.create(parent) as DecoratorMetadataObject;

    Option({ name: "b" })(class {}, {
      kind: "class",
      name: "Child",
      metadata,
      addInitializer: (): void => {},
    } as ClassDecoratorContext);

    assertEquals(parent[CLI_OPTIONS_METADATA], [{ name: "a" }]);
    assertEquals(metadata[CLI_OPTIONS_METADATA], [{ name: "b" }, {
      name: "a",
    }]);
  });
});
