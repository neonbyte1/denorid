import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CONTROLLER_REQUEST_MAPPING } from "../_constants.ts";
import type { RequestMappingMetadata } from "./_request_mapping.ts";
import { Body, Form } from "./validation.ts";

const getMetadata = (
  target: object,
): RequestMappingMetadata[] | undefined =>
  (target as { [Symbol.metadata]: Record<symbol | string, unknown> })[
    Symbol.metadata
  ]?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;

describe("HTTP: Body decorator", () => {
  it("should throw when decorating a static method", () => {
    const dto = {};
    assertThrows(() => {
      class _ {
        @Body(dto)
        public static stub(): void {}
      }
    }, Error);
  });

  it("should set validation type to 'json'", () => {
    const dto = {};

    class ExampleController {
      @Body(dto)
      public handler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.validation?.type, "json");
  });

  it("should set the dto on the metadata entry", () => {
    const dto = { parse: () => {} };

    class ExampleController {
      @Body(dto)
      public handler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.validation?.dto, dto);
  });

  it("should register metadata under the correct method name", () => {
    const dto = {};

    class ExampleController {
      @Body(dto)
      public myHandler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.name, "myHandler");
  });
});

describe("HTTP: Form decorator", () => {
  it("should throw when decorating a static method", () => {
    const dto = {};
    assertThrows(() => {
      class _ {
        @Form(dto)
        public static stub(): void {}
      }
    }, Error);
  });

  it("should set validation type to 'form'", () => {
    const dto = {};

    class ExampleController {
      @Form(dto)
      public handler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.validation?.type, "form");
  });

  it("should set the dto on the metadata entry", () => {
    const dto = { parse: () => {} };

    class ExampleController {
      @Form(dto)
      public handler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.validation?.dto, dto);
  });

  it("should register metadata under the correct method name", () => {
    const dto = {};

    class ExampleController {
      @Form(dto)
      public myHandler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.name, "myHandler");
  });
});
