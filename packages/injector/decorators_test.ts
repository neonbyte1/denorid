import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertThrows,
} from "@std/assert";
import { describe, it } from "node:test";
import {
  getInjectableMetadata,
  getInjectionDependencies,
  getModuleMetadata,
} from "./_internal.ts";
import type { InjectableMetadata, InjectionDependency } from "./_metadata.ts";
import { runInRequestContextAsync } from "./_request_context.ts";
import { noopLogger, SimpleService, TAG_A } from "./_test_fixtures.ts";
import type { Tag, Type } from "./common.ts";
import {
  GLOBAL_MODULE_METADATA,
  INJECTABLE_METADATA,
  INJECTION_METADATA,
  TAG_METADATA,
} from "./constants.ts";
import { Container } from "./container.ts";
import { Global, Inject, Injectable, Module, Tags } from "./decorators.ts";
import { InvalidStaticMemberDecoratorUsageError } from "./errors.ts";

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
        InvalidStaticMemberDecoratorUsageError,
        'Decorator @Inject() cannot be applied to static property "dep".',
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

    it("should store expression in metadata", () => {
      const expr = (svc: SimpleService): string => svc.value.toUpperCase();

      @Injectable()
      class TestService {
        @Inject(SimpleService, expr)
        field!: string;
      }

      const deps = TestService[Symbol.metadata]
        ?.[INJECTION_METADATA] as InjectionDependency[];

      assertExists(deps);
      assertEquals(deps.length, 1);
      assert(deps[0].expression === expr);
      assertEquals(deps[0].options, undefined);
    });

    it("should store expression and options in metadata", () => {
      const expr = (svc: SimpleService): string => svc.value;

      @Injectable()
      class TestService {
        @Inject(SimpleService, expr, { optional: true })
        field?: string;
      }

      const deps = TestService[Symbol.metadata]
        ?.[INJECTION_METADATA] as InjectionDependency[];

      assertExists(deps);
      assertEquals(deps.length, 1);
      assert(deps[0].expression === expr);
      assertEquals(deps[0].options?.optional, true);
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

  describe("subclasses", () => {
    function injectionsOf(target: Type): [string | symbol, unknown][] {
      return getInjectionDependencies(target).map((
        { field, token },
      ) => [field, token]);
    }

    it("gives a decorated subclass its own @Injectable options", () => {
      @Injectable()
      class Base {}

      @Injectable({ mode: "request" })
      class Child extends Base {}

      const base = getInjectableMetadata(Base)!;
      const child = getInjectableMetadata(Child)!;

      assertEquals(base.mode, undefined);
      assertEquals(child.mode, "request");
      assert(base.id !== child.id);
    });

    it("lets an undecorated subclass inherit the @Injectable options", () => {
      @Injectable({ mode: "transient" })
      class Base {}

      class Child extends Base {}

      assertEquals(getInjectableMetadata(Child)?.mode, "transient");
    });

    it("resolves a request-scoped subclass per request and its base as singleton", async () => {
      @Injectable()
      class Base {
        @Inject(SimpleService)
        public simple!: SimpleService;
      }

      @Injectable({ mode: "request" })
      class Child extends Base {
        @Inject("CHILD_ONLY")
        public extra!: string;
      }

      const container = new Container(noopLogger);

      container.register(SimpleService, Base, Child, {
        provide: "CHILD_ONLY",
        useValue: "extra",
      });

      const [first, second] = await Promise.all(
        ["req-1", "req-2"].map((id) =>
          runInRequestContextAsync(id, () => container.resolve(Child))
        ),
      );
      const base = await container.resolve(Base);

      assert(first !== second);
      assertEquals(first.extra, "extra");
      assertInstanceOf(first.simple, SimpleService);
      assertInstanceOf(base.simple, SimpleService);
      assertEquals(injectionsOf(Base), [["simple", SimpleService]]);
    });

    it("adds the subclass injections without changing the parent", () => {
      @Injectable()
      class Base {
        @Inject("A")
        public a!: unknown;
      }

      @Injectable()
      class Child extends Base {
        @Inject("B")
        public b!: unknown;
      }

      assertEquals(injectionsOf(Base), [["a", "A"]]);
      assertEquals(injectionsOf(Child), [["a", "A"], ["b", "B"]]);
    });

    it("lets a subclass redeclare an injected field", () => {
      @Injectable()
      class Base {
        @Inject("A")
        public dep!: unknown;
      }

      @Injectable()
      class Child extends Base {
        @Inject("B")
        public override dep: unknown = undefined;
      }

      assertEquals(injectionsOf(Base), [["dep", "A"]]);
      assertEquals(injectionsOf(Child), [["dep", "B"]]);
    });

    it("still rejects two injections into the same field of a subclass", () => {
      @Injectable()
      class Base {
        @Inject("A")
        public dep!: unknown;
      }

      assertThrows(
        () => {
          @Injectable()
          class _Child extends Base {
            @Inject("B")
            @Inject("C")
            public override dep: unknown = undefined;
          }
        },
        Error,
        "Cannot inject multiple",
      );
    });

    it("gives a subclass module its own @Module metadata", () => {
      @Module({ providers: [SimpleService] })
      class BaseModule {}

      @Module({ providers: [] })
      class ChildModule extends BaseModule {}

      assertEquals(getModuleMetadata(ChildModule), { providers: [] });
      assertEquals(getModuleMetadata(BaseModule), {
        providers: [SimpleService],
      });
    });
  });
});
