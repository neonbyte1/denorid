import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  GLOBAL_MODULE_METADATA,
  INJECTABLE_METADATA,
  type InjectableMetadata,
  TAG_METADATA,
} from "./_metadata.ts";
import { SimpleService, TAG_A } from "./_test_fixtures.ts";
import type { Tag } from "./common.ts";
import { Global, Inject, Injectable, Module, Tags } from "./decorators.ts";

describe("decorators.ts", () => {
  describe("@Injectable()", () => {
    it("should mark class as injectable singleton", () => {
      @Injectable()
      class TestService {}

      const metdata = TestService[Symbol.metadata]?.[INJECTABLE_METADATA] as
        | InjectableMetadata
        | undefined;

      assertExists(metdata);
      assertEquals(typeof metdata, "object");
      assertEquals(typeof metdata!.id, "string");
    });

    it("should mark class as injectable with custom mode", () => {
      @Injectable({ mode: "transient" })
      class TestService {}

      const metdata = TestService[Symbol.metadata]?.[INJECTABLE_METADATA] as
        | InjectableMetadata
        | undefined;

      assertExists(metdata);
      assertExists(metdata!.mode);
      assertEquals(metdata!.mode!, "transient");
    });
  });

  describe("@Inject", () => {
    it("should register field dependency", () => {
      @Injectable()
      class TestService {
        @Inject(SimpleService)
        dep!: SimpleService;
      }

      const metadata = TestService[Symbol.metadata];
      assertExists(metadata);
    });

    it("should support optional dependencies", () => {
      @Injectable()
      class TestService {
        @Inject("OPTIONAL", { optional: true })
        optional?: string;
      }

      const metadata = TestService[Symbol.metadata];
      assertExists(metadata);
    });

    it("should throw on static fields", () => {
      assertThrows(
        () => {
          @Injectable()
          class _TestService {
            @Inject(SimpleService)
            static dep: SimpleService;
          }
        },
        Error,
        "static",
      );
    });

    it("should throw on duplicate field injection", () => {
      assertThrows(
        () => {
          @Injectable()
          class _TestService {
            @Inject(SimpleService)
            @Inject(SimpleService)
            dep!: SimpleService;
          }
        },
        Error,
        "Cannot inject multiple",
      );
    });
  });

  describe("@Module", () => {
    it("should register module metadata", () => {
      @Module({ providers: [SimpleService] })
      class TestModule {}

      const metadata = TestModule[Symbol.metadata];
      assertExists(metadata);
    });

    it("should register module with imports and exports", () => {
      @Module({ providers: [SimpleService], exports: [SimpleService] })
      class SubModule {}

      @Module({ imports: [SubModule] })
      class TestModule {}

      const metadata = TestModule[Symbol.metadata];
      assertExists(metadata);
    });
  });

  describe("@Global", () => {
    it("should mark module as global", () => {
      @Global()
      @Module({ providers: [SimpleService] })
      class GlobalModule {}

      const isGlobal = GlobalModule[Symbol.metadata]
        ?.[GLOBAL_MODULE_METADATA] as boolean | undefined;

      assertEquals(isGlobal, true);
    });
  });

  describe("@Tags", () => {
    it("should register tags on class", () => {
      const MY_TAG = Symbol("MY_TAG");

      @Injectable()
      @Tags(MY_TAG, "string_tag")
      class TestService {}

      const tags = TestService[Symbol.metadata]?.[TAG_METADATA] as
        | Tag[]
        | undefined;

      assertExists(tags);
      assertEquals(tags.length, 2);
      assertEquals(tags.includes(MY_TAG), true);
      assertEquals(tags.includes("string_tag"), true);
    });

    it("should deduplicate tags", () => {
      @Injectable()
      @Tags(TAG_A, TAG_A)
      class TestService {}

      const tags = TestService[Symbol.metadata]?.[TAG_METADATA] as
        | Tag[]
        | undefined;

      assertExists(tags);
      assertEquals(tags.length, 1);
      assertEquals(tags[0], TAG_A);
    });
  });
});
