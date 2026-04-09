import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CONTROLLER_REQUEST_MAPPING } from "../_constants.ts";
import type { RequestMappingMetadata } from "./_request_mapping.ts";
import { HttpCode } from "./http_code.ts";
import { Post } from "./request_mapping.ts";
import { StatusCode } from "./status.ts";

describe("@HttpCode()", () => {
  it("should create the request mapping entry if called before request mapping decorator", () => {
    class ExampleClass {
      @HttpCode(StatusCode.NoContent)
      public something(): void {}
    }

    const metadata = ExampleClass[Symbol.metadata]
      ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;

    assertExists(metadata);
    assertEquals(metadata.at(0)?.statusCode, StatusCode.NoContent);
  });

  it("should add the statusCode property to an existing entry", () => {
    class ExampleClass {
      @Post("/delete")
      public deleteRoute(): void {}

      @Post("/create")
      @HttpCode(StatusCode.Created)
      public something(): void {}
    }

    const metadata = ExampleClass[Symbol.metadata]
      ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;

    assertExists(metadata);
    assertEquals(metadata.at(1)?.path, "/create");
    assertEquals(metadata.at(1)?.statusCode, StatusCode.Created);
  });
});
