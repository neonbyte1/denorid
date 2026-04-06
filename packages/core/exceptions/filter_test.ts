import type { Tag } from "@denorid/injector";
import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { EXCEPTION_FILTER, EXCEPTION_FILTER_METADATA } from "../_constants.ts";
import { Catch, type ExceptionFilterMetadata } from "./filter.ts";

const INJECTABLE_METADATA = Symbol.for("denorid.injectable");
const TAG_METADATA = Symbol.for("denorid.tags");

class TestError extends Error {}

describe("Catch", () => {
  describe("overload: Catch(exceptionClass)", () => {
    it("sets EXCEPTION_FILTER_METADATA with only target", () => {
      @Catch(TestError)
      class TestFilter {}

      const meta = TestFilter[Symbol.metadata]?.[EXCEPTION_FILTER_METADATA] as
        | ExceptionFilterMetadata<TestError>
        | undefined;

      assertExists(meta);
      assertEquals(meta.target, TestError);
      assertEquals(meta.priority, undefined);
    });

    it("marks the class as injectable", () => {
      @Catch(TestError)
      class TestFilter {}

      assertExists(TestFilter[Symbol.metadata]?.[INJECTABLE_METADATA]);
    });

    it("tags the class with EXCEPTION_FILTER", () => {
      @Catch(TestError)
      class TestFilter {}

      const tags = TestFilter[Symbol.metadata]?.[TAG_METADATA] as
        | Tag[]
        | undefined;

      assertExists(tags);
      assertEquals(tags.includes(EXCEPTION_FILTER), true);
    });
  });

  describe("overload: Catch(exceptionClass, options)", () => {
    it("sets EXCEPTION_FILTER_METADATA with target and priority", () => {
      @Catch(TestError, { priority: 10 })
      class TestFilter {}

      const meta = TestFilter[Symbol.metadata]?.[EXCEPTION_FILTER_METADATA] as
        | ExceptionFilterMetadata<TestError>
        | undefined;

      assertExists(meta);
      assertEquals(meta.target, TestError);
      assertEquals(meta.priority, 10);
    });

    it("marks the class as injectable", () => {
      @Catch(TestError, { priority: 5 })
      class TestFilter {}

      assertExists(TestFilter[Symbol.metadata]?.[INJECTABLE_METADATA]);
    });

    it("tags the class with EXCEPTION_FILTER", () => {
      @Catch(TestError, { priority: 5 })
      class TestFilter {}

      const tags = TestFilter[Symbol.metadata]?.[TAG_METADATA] as
        | Tag[]
        | undefined;

      assertExists(tags);
      assertEquals(tags.includes(EXCEPTION_FILTER), true);
    });
  });

  describe("overload: Catch(metadataObject)", () => {
    it("sets EXCEPTION_FILTER_METADATA from the provided object", () => {
      const filterMeta: ExceptionFilterMetadata<TestError> = {
        target: TestError,
        priority: 42,
      };

      @Catch(filterMeta)
      class TestFilter {}

      const meta = TestFilter[Symbol.metadata]?.[EXCEPTION_FILTER_METADATA] as
        | ExceptionFilterMetadata<TestError>
        | undefined;

      assertExists(meta);
      assertEquals(meta, filterMeta);
    });

    it("sets EXCEPTION_FILTER_METADATA from an object without priority", () => {
      const filterMeta: ExceptionFilterMetadata<TestError> = {
        target: TestError,
      };

      @Catch(filterMeta)
      class TestFilter {}

      const meta = TestFilter[Symbol.metadata]?.[EXCEPTION_FILTER_METADATA] as
        | ExceptionFilterMetadata<TestError>
        | undefined;

      assertExists(meta);
      assertEquals(meta.target, TestError);
      assertEquals(meta.priority, undefined);
    });

    it("marks the class as injectable", () => {
      @Catch({ target: TestError })
      class TestFilter {}

      assertExists(TestFilter[Symbol.metadata]?.[INJECTABLE_METADATA]);
    });

    it("tags the class with EXCEPTION_FILTER", () => {
      @Catch({ target: TestError })
      class TestFilter {}

      const tags = TestFilter[Symbol.metadata]?.[TAG_METADATA] as
        | Tag[]
        | undefined;

      assertExists(tags);
      assertEquals(tags.includes(EXCEPTION_FILTER), true);
    });
  });
});
