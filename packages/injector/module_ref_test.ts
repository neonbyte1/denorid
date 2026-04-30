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
import { Injectable, Module, Tags } from "./decorators.ts";
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

    it("should throw for non-module token (strict: true)", async () => {
      @Module({
        providers: [ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);

      assertThrows(
        () => service.moduleRef.get(SimpleService, { strict: true }),
        Error,
        "not available",
      );
    });

    it("should resolve token with contextId using resolveWithContext", async () => {
      @Module({
        providers: [TransientService, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const a = await service.moduleRef.get(TransientService, {
        contextId: "ctx-1",
      });
      const b = await service.moduleRef.get(TransientService, {
        contextId: "ctx-1",
      });

      assertInstanceOf(a, TransientService);
      assertEquals(a.id, b.id);
    });

    it("should resolve module-scoped token via strict: false when not exported to parent", async () => {
      @Module({
        providers: [TaggedServiceA, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class FeatureModule {}

      @Module({
        imports: [FeatureModule],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const tokens = service.moduleRef.getTokensByTag(TAG_A);

      assertEquals(tokens.length, 1);

      const instance = await service.moduleRef.get(tokens[0]!, {
        strict: false,
      });

      assertInstanceOf(instance, TaggedServiceA);
    });

    it("should resolve host module tokens when strict is false", async () => {
      class HostService {}

      @Module({
        providers: [ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class FeatureModule {}

      @Module({
        imports: [FeatureModule],
        providers: [HostService],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const host = await service.moduleRef.get(HostService, {
        strict: false,
      });

      assertInstanceOf(host, HostService);
      assertThrows(
        () => service.moduleRef.get(HostService),
        Error,
        "not available",
      );
    });

    it("should resolve host module tokens with contextId when strict is false", async () => {
      @Module({
        providers: [ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class FeatureModule {}

      @Module({
        imports: [FeatureModule],
        providers: [TransientService],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const a = await service.moduleRef.get(TransientService, {
        contextId: "ctx-1",
        strict: false,
      });
      const b = await service.moduleRef.get(TransientService, {
        contextId: "ctx-1",
        strict: false,
      });

      assertInstanceOf(a, TransientService);
      assertEquals(a.id, b.id);
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

    it("should filter by module tokens (strict: true)", async () => {
      @Module({
        providers: [TaggedServiceA, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const tagged = await service.moduleRef.getByTag<{ name: string }>(TAG_A);

      assertEquals(tagged.length, 1);
    });

    it("should not include host module tags by default", async () => {
      @Module({
        providers: [ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class FeatureModule {}

      @Module({
        imports: [FeatureModule],
        providers: [TaggedServiceA],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const tagged = await service.moduleRef.getByTag<{ name: string }>(TAG_A);

      assertEquals(tagged.length, 0);
    });

    it("should include host module tags when strict is false", async () => {
      @Module({
        providers: [ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class FeatureModule {}

      @Module({
        imports: [FeatureModule],
        providers: [TaggedServiceA],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const tagged = await service.moduleRef.getByTag<{ name: string }>(TAG_A, {
        strict: false,
      });

      assertEquals(tagged.map((item) => item.name), ["A"]);
    });

    it("should resolve module-scoped tags with contextId", async () => {
      const TAG = Symbol("TAGGED_TRANSIENT");

      @Injectable({ mode: "transient" })
      @Tags(TAG)
      class TaggedTransient {
        public id = crypto.randomUUID();
      }

      @Module({
        providers: [TaggedTransient, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const [a] = await service.moduleRef.getByTag<TaggedTransient>(TAG, {
        contextId: "ctx-1",
      });
      const [b] = await service.moduleRef.getByTag<TaggedTransient>(TAG, {
        contextId: "ctx-1",
      });

      assertInstanceOf(a, TaggedTransient);
      assertEquals(a.id, b.id);
    });

    it("should resolve host module tags with contextId when strict is false", async () => {
      const TAG = Symbol("TAGGED_TRANSIENT");

      @Injectable({ mode: "transient" })
      @Tags(TAG)
      class TaggedTransient {
        public id = crypto.randomUUID();
      }

      @Module({
        providers: [ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class FeatureModule {}

      @Module({
        imports: [FeatureModule],
        providers: [TaggedTransient],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const [a] = await service.moduleRef.getByTag<TaggedTransient>(TAG, {
        contextId: "ctx-1",
        strict: false,
      });
      const [b] = await service.moduleRef.getByTag<TaggedTransient>(TAG, {
        contextId: "ctx-1",
        strict: false,
      });

      assertEquals(a.id, b.id);
    });
  });

  describe("getTokensByTag", () => {
    it("should get tagged provider tokens from the current module by default", async () => {
      @Module({
        providers: [TaggedServiceA, TaggedServiceB, ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const tokens = service.moduleRef.getTokensByTag(TAG_A);

      assertEquals(tokens, [TaggedServiceA, TaggedServiceB]);
    });

    it("should not include host module tagged tokens by default", async () => {
      @Module({
        providers: [ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class FeatureModule {}

      @Module({
        imports: [FeatureModule],
        providers: [TaggedServiceA],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const tokens = service.moduleRef.getTokensByTag(TAG_A);

      assertEquals(tokens, []);
    });

    it("should include application tagged tokens when strict is false", async () => {
      @Module({
        providers: [ServiceWithModuleRef],
        exports: [ServiceWithModuleRef],
      })
      class FeatureModule {}

      @Module({
        imports: [FeatureModule],
        providers: [TaggedServiceA],
        exports: [ServiceWithModuleRef],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const service = await ctx.resolve(ServiceWithModuleRef);
      const tokens = service.moduleRef.getTokensByTag(TAG_A, {
        strict: false,
      });

      assertEquals(tokens, [TaggedServiceA]);
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
