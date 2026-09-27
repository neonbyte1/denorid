import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import { z } from "zod";
import { getRequestMappingMetadata as getMetadata } from "./_request_mapping.ts";
import { Body, Form } from "./validation.ts";

describe("HTTP: Body decorator", () => {
  it("should throw when decorating a static method", () => {
    const dto = z.object({});
    assertThrows(() => {
      class _ {
        @Body(dto)
        public static stub(): void {}
      }
    }, Error);
  });

  it("should set validation type to 'json'", () => {
    const dto = z.object({});

    class ExampleController {
      @Body(dto)
      public handler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.validation?.type, "json");
  });

  it("should set the dto on the metadata entry", () => {
    const dto = z.object({ name: z.string() });

    class ExampleController {
      @Body(dto)
      public handler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.validation?.dto, dto);
  });

  it("should register metadata under the correct method name", () => {
    const dto = z.object({});

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
    const dto = z.object({});
    assertThrows(() => {
      class _ {
        @Form(dto)
        public static stub(): void {}
      }
    }, Error);
  });

  it("should set validation type to 'form'", () => {
    const dto = z.object({});

    class ExampleController {
      @Form(dto)
      public handler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.validation?.type, "form");
  });

  it("should set the dto on the metadata entry", () => {
    const dto = z.object({ file: z.string() });

    class ExampleController {
      @Form(dto)
      public handler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.validation?.dto, dto);
  });

  it("should register metadata under the correct method name", () => {
    const dto = z.object({});

    class ExampleController {
      @Form(dto)
      public myHandler(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(metadata.at(0)?.name, "myHandler");
  });
});
