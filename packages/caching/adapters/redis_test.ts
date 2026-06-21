import { Test } from "@denorid/core/testing";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { spy, stub } from "@std/testing/mock";
import { Keyv } from "keyv";
import { CACHE_MANAGER } from "../_constants.ts";
import { CachingModule } from "../module.ts";
import type { Cache } from "../module_options.ts";
import { KeyvRedis, redisStore, redisStoreNonBlocking } from "./redis.ts";

describe("redis adapter", () => {
  describe("redisStore", () => {
    it("returns a Keyv wrapping a KeyvRedis store and forwards the namespace", () => {
      const store = redisStore("redis://localhost:6379", { namespace: "ns" });

      assertInstanceOf(store, Keyv);
      assertEquals(store.namespace, "ns");
      assertInstanceOf(store.store, KeyvRedis);
    });

    it("defaults the connection target when called with no arguments", () => {
      const store = redisStore();

      assertInstanceOf(store, Keyv);
      assertInstanceOf(store.store, KeyvRedis);
    });
  });

  describe("redisStoreNonBlocking", () => {
    it("returns a distinct Keyv whose store is a KeyvRedis (not aliased to redisStore)", () => {
      const blocking = redisStore("redis://localhost:6379");
      const nonBlocking = redisStoreNonBlocking("redis://localhost:6379");

      assertInstanceOf(nonBlocking, Keyv);
      assertInstanceOf(nonBlocking.store, KeyvRedis);
      // Sanity: separate instances, not the same object handed back twice.
      if (blocking === nonBlocking) {
        throw new Error("redisStoreNonBlocking returned the same instance as redisStore");
      }
    });
  });

  describe("CachingModule wiring", () => {
    it("exposes the redis-backed Keyv as the first cache store and disconnects it on shutdown", async () => {
      const store = redisStore("redis://localhost:6379", { namespace: "wire" });
      const adapter = store.store;
      assertInstanceOf(adapter, KeyvRedis);

      // Prevent the test from opening a real TCP connection on close.
      const adapterDisconnect = stub(adapter, "disconnect", () => Promise.resolve());
      const storeDisconnect = spy(store, "disconnect");

      const module = await Test.createTestingModule({
        imports: [CachingModule.forRoot({ stores: [store] })],
      })
        .useCoreGlobals()
        .compile();

      try {
        const cache = await module.get<Cache>(CACHE_MANAGER);

        assertEquals(cache.stores.length, 1);
        assertStrictEquals(cache.stores[0], store);

        await module.close();

        assertEquals(storeDisconnect.calls.length, 1);
      } finally {
        adapterDisconnect.restore();
        storeDisconnect.restore();
      }
    });
  });
});
