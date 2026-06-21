import { Test } from "@denorid/core/testing";
import type {
  BaseProvider,
  FactoryProvider,
  ValueProvider,
} from "@denorid/injector";
import { Injectable, Module, type Type } from "@denorid/injector";
import {
  assertEquals,
  assertExists,
  assertNotStrictEquals,
  assertStrictEquals,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { spy } from "@std/testing/mock";
import { CACHE_MANAGER, CACHING_MODULE_OPTIONS } from "./_constants.ts";
import { InjectCache } from "./decorator.ts";
import { CachingModule } from "./module.ts";
import type { Cache } from "./module_options.ts";

describe(CachingModule.name, () => {
  describe("forRoot", () => {
    it("registers a value provider for options and a factory provider for the cache", () => {
      const options = { ttl: 1_000 };
      const mod = CachingModule.forRoot(options);

      assertEquals(mod.module, CachingModule);
      assertEquals(mod.global, undefined);
      assertEquals(mod.imports, []);

      const optionsProvider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === CACHING_MODULE_OPTIONS,
      );
      assertExists(optionsProvider);
      assertStrictEquals((optionsProvider as ValueProvider).useValue, options);

      const cacheProvider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === CACHE_MANAGER,
      );
      assertExists(cacheProvider);
      assertEquals(
        (cacheProvider as FactoryProvider).inject,
        [CACHING_MODULE_OPTIONS],
      );
    });

    it("propagates the global flag", () => {
      const mod = CachingModule.forRoot({ global: true });

      assertEquals(mod.global, true);
    });

    it("defaults to an empty options object when none is provided", () => {
      const mod = CachingModule.forRoot();
      const optionsProvider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === CACHING_MODULE_OPTIONS,
      ) as ValueProvider;

      assertEquals(optionsProvider.useValue, {});
    });
  });

  describe("forRootAsync", () => {
    it("registers a factory provider with the supplied useFactory and inject", () => {
      const TOKEN = Symbol("TOKEN");
      const useFactory = () => ({ ttl: 500 });
      const mod = CachingModule.forRootAsync({
        useFactory,
        inject: [TOKEN],
      });

      const optionsProvider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === CACHING_MODULE_OPTIONS,
      ) as FactoryProvider;

      assertStrictEquals(optionsProvider.useFactory, useFactory);
      assertEquals(optionsProvider.inject, [TOKEN]);
    });

    it("flows imports, extraProviders, and global through", () => {
      const TOKEN = Symbol("TOKEN");
      const fakeImport = class {} as Type;
      const extra: ValueProvider = { provide: "EXTRA", useValue: 42 };
      const mod = CachingModule.forRootAsync({
        global: true,
        imports: [fakeImport],
        inject: [TOKEN],
        useFactory: () => ({}),
        extraProviders: [extra],
      });

      assertEquals(mod.global, true);
      assertEquals(mod.imports, [fakeImport]);
      assertEquals(mod.providers!.includes(extra), true);
    });
  });

  describe("end-to-end", () => {
    it("compiles a forRoot module and round-trips set/get through the resolved cache", async () => {
      const module = await Test.createTestingModule({
        imports: [CachingModule.forRoot({ ttl: 10_000 })],
      })
        .useCoreGlobals()
        .compile();

      try {
        const cache = await module.get<Cache>(CACHE_MANAGER);

        await cache.set("k", "v");
        assertEquals(await cache.get("k"), "v");

        await cache.del("k");
        assertEquals(await cache.get("k"), undefined);
      } finally {
        await module.close();
      }
    });

    it("compiles a forRootAsync module and serves the same set/get round-trip", async () => {
      const TTL = Symbol("TTL");

      @Module({
        providers: [{ provide: TTL, useValue: 500 }],
        exports: [TTL],
      })
      class TtlModule {}

      const module = await Test.createTestingModule({
        imports: [
          CachingModule.forRootAsync({
            imports: [TtlModule],
            inject: [TTL],
            useFactory: (ttl: number) => Promise.resolve({ ttl }),
          }),
        ],
      })
        .useCoreGlobals()
        .compile();

      try {
        const cache = await module.get<Cache>(CACHE_MANAGER);

        await cache.set("async", 1);
        assertEquals(await cache.get("async"), 1);
      } finally {
        await module.close();
      }
    });

    it("invokes disconnect on the cache during module shutdown", async () => {
      const module = await Test.createTestingModule({
        imports: [CachingModule.forRoot()],
      })
        .useCoreGlobals()
        .compile();

      const cache = await module.get<Cache>(CACHE_MANAGER);
      const disconnectSpy = spy(cache, "disconnect");

      try {
        await module.close();

        assertEquals(disconnectSpy.calls.length, 1);
      } finally {
        disconnectSpy.restore();
      }
    });

    it("resolves the same cache instance through InjectCache as through CACHE_MANAGER", async () => {
      @Injectable()
      class CacheConsumer {
        @InjectCache()
        public readonly cache!: Cache;
      }

      const module = await Test.createTestingModule({
        providers: [CacheConsumer],
        imports: [CachingModule.forRoot()],
      })
        .useCoreGlobals()
        .compile();

      try {
        const direct = await module.get<Cache>(CACHE_MANAGER);
        const consumer = await module.get(CacheConsumer);

        assertStrictEquals(consumer.cache, direct);
        assertNotStrictEquals(consumer.cache, undefined);
      } finally {
        await module.close();
      }
    });
  });
});
