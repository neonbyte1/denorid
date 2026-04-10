import { InvalidStaticMemberDecoratorUsageError } from "@denorid/injector";
import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CONTROLLER_REQUEST_MAPPING } from "../_constants.ts";
import type { RequestMappingMetadata } from "../http/_request_mapping.ts";
import type { CanActivate, CanActivateFn } from "./can_activate.ts";
import { GUARDS_METADATA, UseGuards } from "./decorator.ts";

class MockGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

const mockGuardFn: CanActivateFn = () => true;

describe("@UseGuards()", () => {
  describe("as a class decorator", () => {
    it("should add a guard class (Type<CanActivate>) to the class metadata", () => {
      @UseGuards(MockGuard)
      class ExampleController {}

      const guards = ExampleController[Symbol.metadata]?.[GUARDS_METADATA] as
        | Set<unknown>
        | undefined;

      assertInstanceOf(guards, Set);
      assertEquals(guards.has(MockGuard), true);
    });

    it("should add a guard instance (CanActivate) to the class metadata", () => {
      const instance = new MockGuard();

      @UseGuards(instance)
      class ExampleController {}

      const guards = ExampleController[Symbol.metadata]?.[GUARDS_METADATA] as
        | Set<unknown>
        | undefined;

      assertInstanceOf(guards, Set);
      assertEquals(guards.has(instance), true);
    });

    it("should add a guard function (CanActivateFn) to the class metadata", () => {
      @UseGuards(mockGuardFn)
      class ExampleController {}

      const guards = ExampleController[Symbol.metadata]?.[GUARDS_METADATA] as
        | Set<unknown>
        | undefined;

      assertInstanceOf(guards, Set);
      assertEquals(guards.has(mockGuardFn), true);
    });

    it("should add multiple guards in a single call", () => {
      const instance = new MockGuard();

      @UseGuards(MockGuard, instance, mockGuardFn)
      class ExampleController {}

      const guards = ExampleController[Symbol.metadata]?.[GUARDS_METADATA] as
        | Set<unknown>
        | undefined;

      assertInstanceOf(guards, Set);
      assertEquals(guards.size, 3);
      assertEquals(guards.has(MockGuard), true);
      assertEquals(guards.has(instance), true);
      assertEquals(guards.has(mockGuardFn), true);
    });

    it("should merge guards when applied multiple times", () => {
      @UseGuards(mockGuardFn)
      @UseGuards(MockGuard)
      class ExampleController {}

      const guards = ExampleController[Symbol.metadata]?.[GUARDS_METADATA] as
        | Set<unknown>
        | undefined;

      assertInstanceOf(guards, Set);
      assertEquals(guards.size, 2);
      assertEquals(guards.has(MockGuard), true);
      assertEquals(guards.has(mockGuardFn), true);
    });

    it("should return the target class unchanged", () => {
      class ExampleController {}

      const decorator = UseGuards(MockGuard);
      const result = decorator(
        ExampleController,
        {
          kind: "class",
          name: "ExampleController",
          metadata: {},
          addInitializer: () => {},
        } as unknown as ClassDecoratorContext,
      ) as unknown;

      assertEquals(result, ExampleController);
    });
  });

  describe("as a method decorator", () => {
    it("should throw when decorating a static method", () => {
      assertThrows(
        () => {
          class ExampleController {
            @UseGuards(MockGuard)
            public static stub(): void {}
          }

          // Suppress unused variable warning
          void ExampleController;
        },
        InvalidStaticMemberDecoratorUsageError,
      );
    });

    it("should add a guard class (Type<CanActivate>) to the method metadata", () => {
      class ExampleController {
        @UseGuards(MockGuard)
        public handler(): void {}
      }

      const mappings = ExampleController[Symbol.metadata]
        ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;

      const entry = mappings?.find(({ name }) => name === "handler");
      assertInstanceOf(entry?.guards, Set);
      assertEquals((entry!.guards! as Set<unknown>).has(MockGuard), true);
    });

    it("should add a guard instance (CanActivate) to the method metadata", () => {
      const instance = new MockGuard();

      class ExampleController {
        @UseGuards(instance)
        public handler(): void {}
      }

      const mappings = ExampleController[Symbol.metadata]
        ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;

      const entry = mappings?.find(({ name }) => name === "handler");
      assertInstanceOf(entry?.guards, Set);
      assertEquals(entry!.guards!.has(instance), true);
    });

    it("should add a guard function (CanActivateFn) to the method metadata", () => {
      class ExampleController {
        @UseGuards(mockGuardFn)
        public handler(): void {}
      }

      const mappings = ExampleController[Symbol.metadata]
        ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;

      const entry = mappings?.find(({ name }) => name === "handler");
      assertInstanceOf(entry?.guards, Set);
      assertEquals(entry!.guards!.has(mockGuardFn), true);
    });

    it("should add multiple guards in a single call", () => {
      const instance = new MockGuard();

      class ExampleController {
        @UseGuards(MockGuard, instance, mockGuardFn)
        public handler(): void {}
      }

      const mappings = ExampleController[Symbol.metadata]
        ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;

      const entry = mappings?.find(({ name }) => name === "handler");
      assertInstanceOf(entry?.guards, Set);
      assertEquals(entry!.guards!.size, 3);
      assertEquals((entry!.guards! as Set<unknown>).has(MockGuard), true);
      assertEquals((entry!.guards! as Set<unknown>).has(instance), true);
      assertEquals((entry!.guards! as Set<unknown>).has(mockGuardFn), true);
    });

    it("should merge guards when applied multiple times on the same method", () => {
      class ExampleController {
        @UseGuards(mockGuardFn)
        @UseGuards(MockGuard)
        public handler(): void {}
      }

      const mappings = ExampleController[Symbol.metadata]
        ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;

      const entry = mappings?.find(({ name }) => name === "handler");
      assertInstanceOf(entry?.guards, Set);
      assertEquals(entry!.guards!.size, 2);
      assertEquals((entry!.guards! as Set<unknown>).has(MockGuard), true);
      assertEquals((entry!.guards! as Set<unknown>).has(mockGuardFn), true);
    });

    it("should isolate guards per method", () => {
      class ExampleController {
        @UseGuards(MockGuard)
        public handlerA(): void {}

        @UseGuards(mockGuardFn)
        public handlerB(): void {}
      }

      const mappings = ExampleController[Symbol.metadata]
        ?.[CONTROLLER_REQUEST_MAPPING] as RequestMappingMetadata[] | undefined;

      const entryA = mappings?.find(({ name }) => name === "handlerA");
      const entryB = mappings?.find(({ name }) => name === "handlerB");

      assertInstanceOf(entryA?.guards, Set);
      assertEquals((entryA!.guards! as Set<unknown>).has(MockGuard), true);
      assertEquals((entryA!.guards! as Set<unknown>).has(mockGuardFn), false);

      assertInstanceOf(entryB?.guards, Set);
      assertEquals((entryB!.guards! as Set<unknown>).has(mockGuardFn), true);
      assertEquals((entryB!.guards! as Set<unknown>).has(MockGuard), false);
    });

    it("should return the target method unchanged", () => {
      const fn = function (): void {};
      const decorator = UseGuards(MockGuard);
      const result = decorator(fn as never, {
        kind: "method",
        name: "handler",
        static: false,
        private: false,
        access: { has: () => false, get: (() => {}) as never },
        metadata: {},
        addInitializer: () => {},
      } as ClassMethodDecoratorContext) as unknown;

      assertEquals(result, fn);
    });
  });
});
