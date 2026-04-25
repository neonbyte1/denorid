import type { InjectionToken, InjectorContext, Tag } from "@denorid/injector";
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { TestingModule } from "./testing_module.ts";

function makeCtx(overrides?: Record<string, unknown>): InjectorContext {
  return {
    container: {
      getByTag: (_tag: Tag) => Promise.resolve([]),
      ...(overrides?.container as Record<string, unknown> | undefined),
    },
    resolveInternal: (_token: InjectionToken) => Promise.resolve(undefined),
    onApplicationBootstrap: () => Promise.resolve(),
    onBeforeApplicationShutdown: () => Promise.resolve(),
    onApplicationShutdown: () => Promise.resolve(),
    ...overrides,
  } as unknown as InjectorContext;
}

describe(TestingModule.name, () => {
  describe("get()", () => {
    it("delegates to ctx.resolveInternal with the token", async () => {
      const token = class MyService {};
      const instance = new token();
      const ctx = makeCtx({
        resolveInternal: (_t: InjectionToken) => Promise.resolve(instance),
      });
      const resolveSpy = spy(ctx, "resolveInternal");
      const module = new TestingModule(ctx);

      const result = await module.get(token);

      assertEquals(result, instance);
      assertSpyCalls(resolveSpy, 1);
      assertSpyCall(resolveSpy, 0, { args: [token] });
    });

    it("ignores options and always resolves via resolveInternal", async () => {
      const token = "MY_TOKEN";
      const ctx = makeCtx({
        resolveInternal: (_t: InjectionToken) => Promise.resolve("value"),
      });
      const resolveSpy = spy(ctx, "resolveInternal");
      const module = new TestingModule(ctx);

      await module.get(token as InjectionToken, { strict: false });

      assertSpyCalls(resolveSpy, 1);
    });
  });

  describe("getByTag()", () => {
    it("delegates to ctx.container.getByTag for a single tag", async () => {
      const TAG = Symbol("tag");
      const items = [{ name: "a" }, { name: "b" }];
      const ctx = makeCtx({
        container: {
          getByTag: (_tag: Tag) => Promise.resolve(items),
        },
      });
      const getByTagSpy = spy(ctx.container, "getByTag");
      const module = new TestingModule(ctx);

      const result = await module.getByTag(TAG);

      assertEquals(result, items);
      assertSpyCalls(getByTagSpy, 1);
      assertSpyCall(getByTagSpy, 0, { args: [TAG] });
    });

    it("calls ctx.container.getByTag for each tag and flattens results", async () => {
      const TAG_A = Symbol("a");
      const TAG_B = Symbol("b");
      const resultsA = [{ name: "a" }];
      const resultsB = [{ name: "b" }, { name: "c" }];
      const ctx = makeCtx({
        container: {
          getByTag: (tag: Tag) =>
            Promise.resolve(tag === TAG_A ? resultsA : resultsB),
        },
      });
      const getByTagSpy = spy(ctx.container, "getByTag");
      const module = new TestingModule(ctx);

      const result = await module.getByTag([TAG_A, TAG_B], { contextId: "x" });

      assertEquals(result, [...resultsA, ...resultsB]);
      assertSpyCalls(getByTagSpy, 2);
    });
  });

  describe("init()", () => {
    it("calls ctx.onApplicationBootstrap()", async () => {
      const ctx = makeCtx();
      const bootstrapSpy = spy(ctx, "onApplicationBootstrap");
      const module = new TestingModule(ctx);

      await module.init();

      assertSpyCalls(bootstrapSpy, 1);
    });
  });

  describe("close()", () => {
    it("calls onBeforeApplicationShutdown then onApplicationShutdown in order", async () => {
      const calls: string[] = [];
      const ctx = makeCtx({
        onBeforeApplicationShutdown: () => {
          calls.push("before");
          return Promise.resolve();
        },
        onApplicationShutdown: () => {
          calls.push("shutdown");
          return Promise.resolve();
        },
      });
      const module = new TestingModule(ctx);

      await module.close();

      assertEquals(calls, ["before", "shutdown"]);
    });
  });
});
