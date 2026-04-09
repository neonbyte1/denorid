import type { InjectableOptions, Tag } from "@denorid/injector";
import { assertArrayIncludes, assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  CONTROLLER_METADATA,
  HTTP_CONTROLLER_METADATA,
} from "../_constants.ts";
import { Controller } from "./controller.ts";
import type { ControllerOptions } from "./controller_options.ts";

describe("@Controller()", () => {
  it("should fall-back to '/' path", () => {
    @Controller()
    class ExampleController {}

    const options = ExampleController[Symbol.metadata]?.[CONTROLLER_METADATA] as
      | ControllerOptions
      | undefined;

    assertExists(options);
    assertExists(options.path);
    assertEquals(options.path, "/");
  });

  it("should use the given path-string", () => {
    @Controller("/admin")
    class AdminController {}

    const options = AdminController[Symbol.metadata]?.[CONTROLLER_METADATA] as
      | ControllerOptions
      | undefined;

    assertEquals(options!.path, "/admin");
  });

  it("should use the given array based path", () => {
    @Controller(["user", "profile"])
    class UserController {}

    const options = UserController[Symbol.metadata]?.[CONTROLLER_METADATA] as
      | ControllerOptions
      | undefined;

    assertEquals(Array.isArray(options!.path), true);
    assertEquals(options!.path, ["user", "profile"]);
  });

  it("should use the given options directly", () => {
    @Controller({ mode: "request" })
    class AdminController {}

    const injectableMetadata = AdminController[Symbol.metadata]
      ?.[Symbol.for("denorid.injectable")] as
        | InjectableOptions & { id: string }
        | undefined;

    assertExists(injectableMetadata);
    assertEquals(injectableMetadata.mode, "request");
  });

  it("should be a singleton by default", () => {
    @Controller()
    class ExampleController {}

    const injectableMetadata = ExampleController[Symbol.metadata]
      ?.[Symbol.for("denorid.injectable")] as
        | InjectableOptions & { id: string }
        | undefined;

    assertExists(injectableMetadata);
    assertEquals(injectableMetadata.mode, "singleton");
  });

  it("should be tagged", () => {
    @Controller()
    class ExampleController {}

    const metadata = ExampleController[Symbol.metadata]
      ?.[Symbol.for("denorid.tags")] as Tag[] | undefined;

    assertExists(metadata);
    assertArrayIncludes(metadata, [HTTP_CONTROLLER_METADATA]);
  });
});
