import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import { z } from "zod";
import { getRequestMappingMetadata as getMetadata } from "./_request_mapping.ts";
import { HttpMethod } from "./method.ts";
import { Get } from "./request_mapping.ts";
import { Body, Form, Params, Query, RequestHeaders } from "./validation.ts";

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

describe("HTTP: Query, Params and RequestHeaders decorators", () => {
  it("should throw when decorating a static method", () => {
    const schema = z.object({});

    assertThrows(() => {
      class _ {
        @Query(schema)
        public static stub(): void {}
      }
    }, Error);
    assertThrows(() => {
      class _ {
        @Params(schema)
        public static stub(): void {}
      }
    }, Error);
    assertThrows(() => {
      class _ {
        @RequestHeaders(schema)
        public static stub(): void {}
      }
    }, Error);
  });

  it("should add the schemas to the route entry of the method, in any decorator order", () => {
    const ListQuery = z.object({ limit: z.coerce.number() });
    const ItemParams = z.object({ id: z.uuid() });
    const ItemQuery = z.object({ expand: z.string().optional() });
    const TenantHeaders = z.object({ "x-tenant-id": z.uuid() });

    class ExampleController {
      @Query(ListQuery)
      @Get()
      public list(): void {}

      @Get(":id")
      @Params(ItemParams)
      @Query(ItemQuery)
      @RequestHeaders(TenantHeaders)
      public get(): void {}

      @RequestHeaders(TenantHeaders)
      @Get("/tenant")
      public tenant(): void {}
    }

    const metadata = getMetadata(ExampleController);
    assertExists(metadata);
    assertEquals(
      metadata.map(({ name, method, query, params, headers }) => ({
        name,
        method,
        query,
        params,
        headers,
      })),
      [
        {
          name: "list",
          method: HttpMethod.GET,
          query: ListQuery,
          params: undefined,
          headers: undefined,
        },
        {
          name: "get",
          method: HttpMethod.GET,
          query: ItemQuery,
          params: ItemParams,
          headers: TenantHeaders,
        },
        {
          name: "tenant",
          method: HttpMethod.GET,
          query: undefined,
          params: undefined,
          headers: TenantHeaders,
        },
      ],
    );
  });
});
