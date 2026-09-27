import {
  InvalidStaticMemberDecoratorUsageError,
  type Type,
} from "@denorid/injector";
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import { CONTROLLER_REQUEST_MAPPING } from "../_constants.ts";
import { UseGuards } from "../guards/decorator.ts";
import {
  createRequestMappingDecorator,
  getRequestMappingMetadata,
  type RequestMappingMetadata,
} from "./_request_mapping.ts";
import { Controller } from "./controller.ts";
import { HttpCode } from "./http_code.ts";
import { HttpMethod } from "./method.ts";
import { Get, Post } from "./request_mapping.ts";

/**
 * Returns `[name, method, path]` per route entry of `target`.
 *
 * @param {Type} target - The class to read.
 * @return {[string | symbol, HttpMethod | undefined, RequestMappingMetadata["path"]][]} The routes.
 */
function routesOf(
  target: Type,
): [string | symbol, HttpMethod | undefined, RequestMappingMetadata["path"]][] {
  return (getRequestMappingMetadata(target) ?? []).map((
    { name, method, path },
  ) => [name, method, path]);
}

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

    assertEquals(cached === created, true);
  });

  it("copies inherited entries into the decorator context before writing", () => {
    const guard = (): boolean => true;
    const inherited: RequestMappingMetadata[] = [
      { name: "list", method: HttpMethod.GET, path: "/" },
      { name: "guarded", guards: new Set([guard]) },
    ];
    const metadata = Object.create({
      [CONTROLLER_REQUEST_MAPPING]: inherited,
    }) as DecoratorMetadataObject;

    const own = getRequestMappingMetadata(
      {
        kind: "class",
        name: "",
        metadata,
        addInitializer: (_: unknown): void => {},
      } satisfies ClassDecoratorContext,
    );

    assertEquals(own, inherited);
    assertEquals(own === inherited, false);
    assertEquals(own[0] === inherited[0], false);
    assertEquals(own[1].guards === inherited[1].guards, false);
    assertEquals(Object.hasOwn(own[0], "guards"), false);
  });

  it("returns undefined for undecorated classes", () => {
    class ExampleClass {}

    assertEquals(getRequestMappingMetadata(ExampleClass), undefined);
  });

  it("returns the stored entries of a class", () => {
    class ExampleClass {
      @Get("/a")
      public a(): void {}
    }

    assertEquals(routesOf(ExampleClass), [["a", HttpMethod.GET, "/a"]]);
  });

  it("does not write metadata when reading a class", () => {
    class ExampleClass {}

    ExampleClass[Symbol.metadata] = {};

    assertEquals(getRequestMappingMetadata(ExampleClass), undefined);
    assertEquals(
      Object.hasOwn(ExampleClass[Symbol.metadata]!, CONTROLLER_REQUEST_MAPPING),
      false,
    );
  });
});

// Deno links the metadata of a subclass to its parent's only when the subclass
// has a class decorator, which is always the case for controllers.
describe("request mapping inheritance", () => {
  class CrudController {
    @Get()
    public list(): void {}
  }

  @Controller("admins")
  class AdminController extends CrudController {
    @Post("promote")
    public promote(): void {}
  }

  @Controller("users")
  class UserController extends CrudController {
    @Get("me")
    public me(): void {}

    @Post("")
    public override list(): void {}
  }

  @Controller("plain")
  class PlainController extends CrudController {}

  it("keeps the routes of the parent class unchanged", () => {
    assertEquals(routesOf(CrudController), [["list", HttpMethod.GET, "/"]]);
  });

  it("gives each subclass the inherited routes plus its own", () => {
    assertEquals(routesOf(AdminController), [
      ["list", HttpMethod.GET, "/"],
      ["promote", HttpMethod.POST, "promote"],
    ]);
  });

  it("changes an overridden route only in the overriding subclass", () => {
    assertEquals(routesOf(UserController), [
      ["list", HttpMethod.POST, ""],
      ["me", HttpMethod.GET, "me"],
    ]);
  });

  it("inherits the parent routes when the subclass declares none", () => {
    assertEquals(routesOf(PlainController), [["list", HttpMethod.GET, "/"]]);
  });

  it("does not share method guards with the parent entry", () => {
    const parentGuard = (): boolean => true;
    const childGuard = (): boolean => true;

    @Controller("parent")
    class Parent {
      @UseGuards(parentGuard)
      @Get()
      public list(): void {}
    }

    @Controller("child")
    class Child extends Parent {
      @UseGuards(childGuard)
      public override list(): void {}
    }

    assertEquals(
      [...getRequestMappingMetadata(Parent)![0].guards!],
      [parentGuard],
    );
    assertEquals(
      [...getRequestMappingMetadata(Child)![0].guards!],
      [parentGuard, childGuard],
    );
  });
});

describe(createRequestMappingDecorator.name, () => {
  const Mark = createRequestMappingDecorator({
    name: "Mark",
    initializer: (entry): void => {
      entry.path = "marked";
    },
  });

  it("applies the initializer to the entry of the decorated method", () => {
    class ExampleClass {
      @Mark
      public handler(): void {}
    }

    assertEquals(routesOf(ExampleClass), [["handler", undefined, "marked"]]);
  });

  it("throws when decorating a static method", () => {
    assertThrows(
      () => {
        class _ {
          @Mark
          public static handler(): void {}
        }
      },
      InvalidStaticMemberDecoratorUsageError,
    );
  });

  it("throws when decorating a #private method", () => {
    assertThrows(
      () => {
        class _ {
          @Mark
          #handler(): void {}
        }
      },
      Error,
      'Decorator @Mark() cannot be applied to private function "#handler"',
    );
  });

  it("rejects route decorators on #private methods at decoration time", () => {
    assertThrows(
      () => {
        class _ {
          @Get("secret")
          #secret(): void {}
        }
      },
      Error,
      'Decorator @Get() cannot be applied to private function "#secret"',
    );
    assertThrows(
      () => {
        class _ {
          @HttpCode(201)
          #create(): void {}
        }
      },
      Error,
      'Decorator @HttpCode() cannot be applied to private function "#create"',
    );
  });
});
