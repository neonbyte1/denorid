import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CONTROLLER_REQUEST_MAPPING } from "../_constants.ts";
import type { RequestMappingMetadata } from "./_request_mapping.ts";
import { HttpMethod } from "./method.ts";
import {
  Delete,
  Get,
  Head,
  Options,
  Patch,
  Post,
  Put,
} from "./request_mapping.ts";

describe("HTTP: createRequestMapping decorator", () => {
  it("should throw when decorating static functions", () => {
    assertThrows(() => {
      class _ {
        @Get()
        public static stub(): void {}
      }
    }, Error);
  });

  it("should be able to decorate public and private functions", () => {
    class ExampleController {
      @Get()
      public publicFunction(): void {}

      @Get()
      private privateFunction(): void {}
    }

    const metatada = ExampleController[Symbol.metadata]
      ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;
    assertExists(metatada);
    assertEquals(metatada?.length, 2);
    assertEquals(metatada?.at(0)?.name, "publicFunction");
    assertEquals(metatada?.at(1)?.name, "privateFunction");
  });

  it("should use '/' as default path", () => {
    class ExampleController {
      @Get()
      public something(): void {}
    }

    const metatada = ExampleController[Symbol.metadata]
      ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;
    assertExists(metatada);
    assertEquals(metatada?.at(0)?.path, "/");
  });

  it("should use the correct HTTP methods", () => {
    class Foo {
      @Get()
      public funcUsingGetMethod(): void {}

      @Post()
      public funcUsingPostMethod(): void {}

      @Put()
      public funcUsingPutMethod(): void {}

      @Patch()
      public funcUsingPatchMethod(): void {}

      @Delete()
      public funcUsingDeleteMethod(): void {}

      @Options()
      public funcUsingOptionsMethod(): void {}

      @Head()
      public funcUsingHeadMethod(): void {}
    }

    const metadata = Foo[Symbol.metadata]
      ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;

    assertExists(metadata);
    assertEquals(metadata.length, 7);

    const getMetadata = (name: string): RequestMappingMetadata | undefined =>
      metadata.find((meta) => meta.name === name);

    const getRoute = getMetadata("funcUsingGetMethod");
    assertExists(getRoute);
    assertEquals(getRoute.method, HttpMethod.GET);

    const postRoute = getMetadata("funcUsingPostMethod");
    assertExists(postRoute);
    assertEquals(postRoute.method, HttpMethod.POST);

    const putRoute = getMetadata("funcUsingPutMethod");
    assertExists(putRoute);
    assertEquals(putRoute.method, HttpMethod.PUT);

    const patchRoute = getMetadata("funcUsingPatchMethod");
    assertExists(patchRoute);
    assertEquals(patchRoute.method, HttpMethod.PATCH);

    const deleteRoute = getMetadata("funcUsingDeleteMethod");
    assertExists(deleteRoute);
    assertEquals(deleteRoute.method, HttpMethod.DELETE);

    const optionsRoute = getMetadata("funcUsingOptionsMethod");
    assertExists(optionsRoute);
    assertEquals(optionsRoute.method, HttpMethod.OPTIONS);

    const headRoute = getMetadata("funcUsingHeadMethod");
    assertExists(headRoute);
    assertEquals(headRoute.method, HttpMethod.HEAD);
  });
});
