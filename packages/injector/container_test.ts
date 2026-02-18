import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
} from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  DependentService,
  RequestScopedService,
  ServiceWithOptionalDep,
  SimpleService,
  TAG_A,
  TaggedServiceA,
  TaggedServiceB,
  TransientService,
} from "./_test_fixtures.ts";
import type { InjectableMode } from "./common.ts";
import { Container } from "./container.ts";
import { Inject, Injectable, Tags } from "./decorators.ts";
import {
  CircularDependencyError,
  RequestContextError,
  TokenNotFoundError,
} from "./errors.ts";

describe("Container", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(() => {
    container.clear();
  });

  describe("register", () => {
    it("should register class provider (shorthand)", async () => {
      container.register(SimpleService);

      const instance = await container.resolve(SimpleService);

      assertInstanceOf(instance, SimpleService);
    });

    it("should register value provider", async () => {
      container.register({ provide: "CONFIG", useValue: { env: "test" } });

      const config = await container.resolve<{ env: string }>("CONFIG");

      assertEquals(config.env, "test");
    });

    it("should register factory provider", async () => {
      container.register({
        provide: "TIMESTAMP",
        useFactory: () => Date.now(),
      });

      const ts = await container.resolve<number>("TIMESTAMP");

      assertEquals(typeof ts, "number");
    });

    it("should register factory provider with dependencies", async () => {
      container.register(
        SimpleService,
        {
          provide: "FACTORY_WITH_DEP",
          useFactory: (simple: SimpleService) => simple.value.toUpperCase(),
          inject: [SimpleService],
        },
      );

      const result = await container.resolve<string>("FACTORY_WITH_DEP");

      assertEquals(result, "SIMPLE");
    });

    it("should register class provider (explicit)", async () => {
      container.register({ provide: "SERVICE", useClass: SimpleService });

      const instance = await container.resolve<SimpleService>("SERVICE");

      assertInstanceOf(instance, SimpleService);
    });

    it("should register existing/alias provider", async () => {
      container.register(
        SimpleService,
        {
          provide: "ALIAS",
          useExisting: SimpleService,
        },
      );

      const instance = await container.resolve<SimpleService>("ALIAS");

      assertInstanceOf(instance, SimpleService);
    });

    it("should chain register calls", () => {
      const result = container.register(
        SimpleService,
        { provide: "VALUE", useValue: 42 },
      );

      assertEquals(result, container);
    });

    it("should register multiple providers", async () => {
      container.register(SimpleService, TransientService);

      const simple = await container.resolve(SimpleService);
      const transient = await container.resolve(TransientService);

      assertExists(simple);
      assertExists(transient);
    });
  });

  describe("resolve", () => {
    it("should resolve singleton (default)", async () => {
      container.register(SimpleService);

      const a = await container.resolve(SimpleService);
      const b = await container.resolve(SimpleService);

      assertEquals(a, b);
    });

    it("should resolve transient (new instance each time)", async () => {
      container.register(TransientService);

      const a = await container.resolve(TransientService);
      const b = await container.resolve(TransientService);

      assert(a !== b);
      assert(a.id !== b.id);
    });

    it("should resolve with field injection", async () => {
      container.register(SimpleService, DependentService);

      const instance = await container.resolve(DependentService);

      assertInstanceOf(instance.simple, SimpleService);
    });

    it("should resolve optional dependency as undefined", async () => {
      container.register(ServiceWithOptionalDep);

      const instance = await container.resolve(ServiceWithOptionalDep);

      assertEquals(instance.optional, undefined);
    });

    it("should throw CircularDependencyError", async () => {
      @Injectable()
      class A {
        @Inject("B")
        b!: unknown;
      }

      @Injectable()
      class B {
        @Inject(A)
        a!: A;
      }

      container.register(A);
      container.register({ provide: "B", useClass: B });

      await assertRejects(
        () => container.resolve(A),
        CircularDependencyError,
      );
    });

    it("should throw TokenNotFoundError", async () => {
      await assertRejects(
        () => container.resolve("UNKNOWN"),
        TokenNotFoundError,
      );
    });

    it("should handle existing provider (alias)", async () => {
      const container = new Container();

      container.register(
        SimpleService,
        {
          provide: "ALIAS",
          useExisting: SimpleService,
        },
      );

      const original = await container.resolve(SimpleService);
      const alias = await container.resolve("ALIAS");

      assertEquals(original, alias);
    });

    it("should handle default mode in resolveWithMode", async () => {
      const container = new Container();

      container.register({
        provide: "CUSTOM_MODE",
        useFactory: () => "value",
        mode: "custom" as InjectableMode,
      });

      const a = await container.resolve("CUSTOM_MODE");
      const b = await container.resolve("CUSTOM_MODE");

      assertEquals(a, b);
    });
  });

  describe("tryResolve", () => {
    it("should return instance if found", async () => {
      container.register(SimpleService);

      const instance = await container.tryResolve(SimpleService);

      assertExists(instance);
    });

    it("should return undefined if not found", async () => {
      const instance = await container.tryResolve("UNKNOWN");

      assertEquals(instance, undefined);
    });

    it("should rethrow non-TokenNotFoundError", async () => {
      @Injectable()
      class A {
        @Inject("B")
        b!: unknown;
      }

      @Injectable()
      class B {
        @Inject(A)
        a!: A;
      }

      container.register(A, { provide: "B", useClass: B });

      await assertRejects(
        () => container.tryResolve(A),
        CircularDependencyError,
      );
    });
  });

  describe("has", () => {
    it("should return true if provider exists", () => {
      container.register(SimpleService);

      assertEquals(container.has(SimpleService), true);
    });

    it("should return false if provider does not exist", () => {
      assertEquals(container.has(SimpleService), false);
    });
  });

  describe("canResolve", () => {
    it("should return true for own provider", () => {
      container.register(SimpleService);

      assertEquals(container.canResolve(SimpleService), true);
    });

    it("should return true for exported child provider", () => {
      const child = new Container({ exports: new Set([SimpleService]) });

      child.register(SimpleService);
      container.addChild(child);

      assertEquals(container.canResolve(SimpleService), true);
    });

    it("should return false for non-exported child provider", () => {
      const child = new Container();

      child.register(SimpleService);
      container.addChild(child);

      assertEquals(container.canResolve(SimpleService), false);
    });

    it("should return true for global provider", () => {
      const global = new Container();

      global.register(SimpleService);
      container = new Container({ globalContainer: global });

      assertEquals(container.canResolve(SimpleService), true);
    });
  });

  describe("hierarchical resolution", () => {
    it("should resolve from exported child", async () => {
      const child = new Container({ exports: new Set([SimpleService]) });

      child.register(SimpleService);
      container.addChild(child);

      const instance = await container.resolve(SimpleService);

      assertInstanceOf(instance, SimpleService);
    });

    it("should not resolve from non-exported child", async () => {
      const child = new Container();

      child.register(SimpleService);
      container.addChild(child);

      await assertRejects(
        () => container.resolve(SimpleService),
        TokenNotFoundError,
      );
    });

    it("should resolve from global container", async () => {
      const global = new Container();

      global.register(SimpleService);
      container = new Container({ globalContainer: global });

      const instance = await container.resolve(SimpleService);
      assertInstanceOf(instance, SimpleService);
    });

    it("should prefer own provider over child", async () => {
      @Injectable()
      class OwnService {
        value = "own";
      }

      @Injectable()
      class ChildService {
        value = "child";
      }

      const child = new Container({ exports: new Set(["SERVICE"]) });

      child.register({ provide: "SERVICE", useClass: ChildService });
      container.addChild(child);
      container.register({ provide: "SERVICE", useClass: OwnService });

      const instance = await container.resolve<{ value: string }>("SERVICE");

      assertEquals(instance.value, "own");
    });

    it("should handle child resolve error (non-TokenNotFoundError)", async () => {
      const child = new Container({ exports: new Set(["THROWING"]) });
      child.register({
        provide: "THROWING",
        useFactory: () => {
          throw new Error("Custom factory error");
        },
      });

      container.addChild(child);

      await assertRejects(
        () => container.resolve("THROWING"),
        Error,
        "Custom factory error",
      );
    });
  });

  describe("request scope", () => {
    it("should throw RequestContextError outside context", async () => {
      container.register(RequestScopedService);

      await assertRejects(
        () => container.resolve(RequestScopedService),
        RequestContextError,
      );
    });
  });

  describe("tags", () => {
    it("should resolve by tag", async () => {
      container.register(TaggedServiceA, TaggedServiceB);

      const instances = await container.getByTag<{ name: string }>(TAG_A);

      assertEquals(instances.length, 2);
    });

    it("should get tokens by tag", () => {
      container.register(TaggedServiceA, TaggedServiceB);

      const tokens = container.getTokensByTag(TAG_A);

      assertEquals(tokens.length, 2);
    });

    it("should include exported child tags", async () => {
      const child = new Container({
        exports: new Set([TaggedServiceA]),
      });

      child.register(TaggedServiceA);
      container.addChild(child);
      container.register(TaggedServiceB);

      const instances = await container.getByTag<{ name: string }>(TAG_A);

      assertEquals(instances.length, 2);
    });

    it("should include global tags", async () => {
      const global = new Container();

      global.register(TaggedServiceA);
      container = new Container({ globalContainer: global });
      container.register(TaggedServiceB);

      const instances = await container.getByTag<{ name: string }>(TAG_A);

      assertEquals(instances.length, 2);
    });

    it("should return empty array for unknown tag", async () => {
      const instances = await container.getByTag("UNKNOWN_TAG");

      assertEquals(instances.length, 0);
    });

    it("should handle getTokensByTag with child exports", () => {
      const parent = new Container();
      const child = new Container({ exports: new Set([TaggedServiceA]) });

      child.register(TaggedServiceA);
      parent.addChild(child);

      const tokens = parent.getTokensByTag(TAG_A);

      assertEquals(tokens.length, 1);
    });

    it("should handle getTokensByTag with non-exported child", () => {
      const parent = new Container();
      const child = new Container();

      child.register(TaggedServiceA);
      parent.addChild(child);

      const tokens = parent.getTokensByTag(TAG_A);

      assertEquals(tokens.length, 0);
    });

    it("should handle getTokensByTag with global container", () => {
      const global = new Container();

      global.register(TaggedServiceA);

      const container = new Container({ globalContainer: global });
      const tokens = container.getTokensByTag(TAG_A);

      assertEquals(tokens.length, 1);
    });
  });

  describe("getProviderMode", () => {
    it("should return singleton for default", () => {
      container.register(SimpleService);

      assertEquals(container.getProviderMode(SimpleService), "singleton");
    });

    it("should return transient", () => {
      container.register(TransientService);

      assertEquals(container.getProviderMode(TransientService), "transient");
    });

    it("should return request", () => {
      container.register(RequestScopedService);

      assertEquals(container.getProviderMode(RequestScopedService), "request");
    });

    it("should return undefined for unknown token", () => {
      assertEquals(container.getProviderMode("UNKNOWN"), undefined);
    });

    it("should check child containers", () => {
      const child = new Container({ exports: new Set([TransientService]) });

      child.register(TransientService);
      container.addChild(child);

      assertEquals(container.getProviderMode(TransientService), "transient");
    });

    it("should check global container", () => {
      const global = new Container();

      global.register(TransientService);
      container = new Container({ globalContainer: global });

      assertEquals(container.getProviderMode(TransientService), "transient");
    });

    it("should handle factory provider mode inheritance from token", () => {
      const container = new Container();

      @Injectable({ mode: "transient" })
      class TransientClass {}

      container.register({
        provide: TransientClass,
        useFactory: () => new TransientClass(),
      });

      assertEquals(container.getProviderMode(TransientClass), "transient");
    });

    it("should handle provider.provide as function for mode check", () => {
      const container = new Container();

      @Injectable({ mode: "transient" })
      class MyClass {}

      container.register({
        provide: MyClass,
        useFactory: () => ({}),
      });

      assertEquals(container.getProviderMode(MyClass), "transient");
    });
  });

  describe("isRequestScoped", () => {
    it("should return true for request-scoped", () => {
      container.register(RequestScopedService);

      assertEquals(container.isRequestScoped(RequestScopedService), true);
    });

    it("should return false for singleton", () => {
      container.register(SimpleService);

      assertEquals(container.isRequestScoped(SimpleService), false);
    });
  });

  describe("instantiateClass", () => {
    it("should create instance without ModuleRef", async () => {
      container.register(SimpleService);

      const instance = await container.instantiateClass(DependentService);

      assertInstanceOf(instance.simple, SimpleService);
    });
  });

  describe("getInstances", () => {
    it("should return all resolved instances", async () => {
      container.register(SimpleService);
      await container.resolve(SimpleService);

      const instances = container.getInstances();

      assertEquals(instances.length, 1);
    });

    it("should return instances recursively", async () => {
      const child = new Container({ exports: new Set([TransientService]) });

      child.register(TransientService);
      container.addChild(child);
      container.register(SimpleService);

      await container.resolve(SimpleService);
      await child.resolve(TransientService);

      const instances = container.getInstances({ recursive: true });

      assertEquals(instances.length, 2);
    });

    it("should deduplicate instances", async () => {
      container.register(SimpleService);

      await container.resolve(SimpleService);
      await container.resolve(SimpleService);

      const instances = container.getInstances({ recursive: true });

      assertEquals(instances.length, 1);
    });
  });

  describe("getChildren", () => {
    it("should return empty array initially", () => {
      assertEquals(container.getChildren().length, 0);
    });

    it("should return child containers", () => {
      const child = new Container();

      container.addChild(child);

      assertEquals(container.getChildren().length, 1);
    });

    it("should handle parent linking in constructor", () => {
      const parent = new Container();
      const _ = new Container({ parent });

      assertEquals(parent.getChildren().length, 1);
    });
  });

  describe("createChild", () => {
    it("should create linked child container", () => {
      const _ = container.createChild();

      assertEquals(container.getChildren().length, 1);
    });

    it("should inherit global container", () => {
      const global = new Container();

      global.register(SimpleService);
      container = new Container({ globalContainer: global });

      const child = container.createChild();

      assertEquals(child.canResolve(SimpleService), true);
    });
  });

  describe("clear", () => {
    it("should clear all data", async () => {
      container.register(SimpleService);
      await container.resolve(SimpleService);
      container.clear();

      assertEquals(container.has(SimpleService), false);
      assertEquals(container.getInstances().length, 0);
    });
  });

  describe("setExports / isExported", () => {
    it("should set and check exports", () => {
      container.setExports(new Set([SimpleService]));

      assertEquals(container.isExported(SimpleService), true);
      assertEquals(container.isExported(TransientService), false);
    });
  });

  describe("addChild", () => {
    it("should add child and set parent", () => {
      const child = new Container();

      container.addChild(child);

      assertEquals(container.getChildren().length, 1);
    });
  });

  describe("Container tag edge cases", () => {
    it("should handle getByTag when own tag resolution fails", async () => {
      const container = new Container();
      const FAIL_TAG = Symbol("FAIL_TAG");

      @Injectable()
      @Tags(FAIL_TAG)
      class FailingTaggedService {
        @Inject("MISSING")
        dep!: unknown;
      }

      container.register(FailingTaggedService);

      const instances = await container.getByTag(FAIL_TAG);
      assertEquals(instances.length, 0);
    });

    it("should handle getByTag when global tag resolution fails", async () => {
      const GLOBAL_FAIL_TAG = Symbol("GLOBAL_FAIL_TAG");

      @Injectable()
      @Tags(GLOBAL_FAIL_TAG)
      class GlobalFailingService {
        @Inject("MISSING")
        dep!: unknown;
      }

      const global = new Container();
      global.register(GlobalFailingService);

      const container = new Container({ globalContainer: global });

      const instances = await container.getByTag(GLOBAL_FAIL_TAG);
      assertEquals(instances.length, 0);
    });

    it("should handle getExportedByTag when resolution fails", async () => {
      const EXPORT_FAIL_TAG = Symbol("EXPORT_FAIL_TAG");

      @Injectable()
      @Tags(EXPORT_FAIL_TAG)
      class ExportFailingService {
        @Inject("MISSING")
        dep!: unknown;
      }

      const child = new Container({ exports: new Set([ExportFailingService]) });
      child.register(ExportFailingService);

      const parent = new Container();
      parent.addChild(child);

      const instances = await parent.getByTag(EXPORT_FAIL_TAG);
      assertEquals(instances.length, 0);
    });
  });

  describe("_normalized_provider edge cases", () => {
    it("should handle factory with non-function provide and no mode", async () => {
      const container = new Container();

      container.register({
        provide: "STRING_FACTORY",
        useFactory: () => "factory_value",
      });

      const result = await container.resolve("STRING_FACTORY");
      assertEquals(result, "factory_value");
      assertEquals(container.getProviderMode("STRING_FACTORY"), "singleton");
    });

    it("should inherit mode from @Injectable token in factory provider", async () => {
      @Injectable({ mode: "transient" })
      class FreshTransientClass {
        id = crypto.randomUUID();
      }

      const container = new Container();

      container.register({
        provide: FreshTransientClass,
        useFactory: () => new FreshTransientClass(),
      });

      assertEquals(container.getProviderMode(FreshTransientClass), "transient");

      const a = await container.resolve(FreshTransientClass);
      const b = await container.resolve(FreshTransientClass);

      assert(a.id !== b.id);
    });
  });
});
