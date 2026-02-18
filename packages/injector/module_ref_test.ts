import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertThrows,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  DependentService,
  ServiceWithModuleRef,
  SimpleService,
  TAG_A,
  TaggedServiceA,
  TaggedServiceB,
  TransientService,
} from "./_test_fixtures.ts";
import { Module } from "./decorators.ts";
import { InjectorContext } from "./injector_context.ts";
import { ModuleRef } from "./module_ref.ts";

describe("ModuleRef", () => {
  it("should be injected via constructor", async () => {
    @Module({
      providers: [ServiceWithModuleRef],
      exports: [ServiceWithModuleRef],
    })
    class AppModule {}

    const ctx = await InjectorContext.create(AppModule);
    const service = await ctx.resolve(ServiceWithModuleRef);
    assertExists(service.moduleRef);
    assertInstanceOf(service.moduleRef, ModuleRef);
  });

  describe("get", () => {
    it("should resolve token (strict: true)", async () => {
      @Module({
        providers: [SimpleService, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const simple = await service.moduleRef.get(SimpleService);
      assertInstanceOf(simple, SimpleService);
    });

    it("should throw for non-module token (strict: false)", async () => {
      @Module({
        providers: [ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);

      assertThrows(
        () => service.moduleRef.get(SimpleService, { strict: false }),
        Error,
        "not available",
      );
    });
  });

  describe("tryGet", () => {
    it("should return undefined if not found", async () => {
      @Module({
        providers: [ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const result = await service.moduleRef.tryGet("UNKNOWN");

      assertEquals(result, undefined);
    });
  });

  describe("has / hasGlobal", () => {
    it("should check module tokens", async () => {
      @Module({
        providers: [SimpleService, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);

      assertEquals(service.moduleRef.has(SimpleService), true);
      assertEquals(service.moduleRef.has(TransientService), false);
    });

    it("should check global tokens", async () => {
      @Module({
        providers: [SimpleService, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);

      assertEquals(service.moduleRef.hasGlobal(SimpleService), true);
    });
  });

  describe("getByTag", () => {
    it("should get tagged services (strict: true)", async () => {
      @Module({
        providers: [TaggedServiceA, TaggedServiceB, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const tagged = await service.moduleRef.getByTag<{ name: string }>(TAG_A);

      assertEquals(tagged.length, 2);
    });

    it("should filter by module tokens (strict: false)", async () => {
      @Module({
        providers: [TaggedServiceA, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const tagged = await service.moduleRef.getByTag<{ name: string }>(TAG_A, {
        strict: false,
      });

      assertEquals(tagged.length, 1);
    });
  });

  describe("create", () => {
    it("should instantiate class with dependencies", async () => {
      @Module({
        providers: [SimpleService, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const dependent = await service.moduleRef.create(DependentService);

      assertInstanceOf(dependent.simple, SimpleService);
    });
  });
});
