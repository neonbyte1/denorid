import type {
  BaseProvider,
  FactoryProvider,
  ValueProvider,
} from "@denorid/injector";
import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { JWT_MODULE_OPTIONS } from "./_constants.ts";
import { JwtModule } from "./jwt_module.ts";

describe("JwtModule", () => {
  describe("forRoot", () => {
    it("creates DynamicModule with useValue provider and empty imports", () => {
      const options = { secret: "s" };
      const mod = JwtModule.forRoot(options);

      assertEquals(mod.module, JwtModule);
      assertEquals(mod.global, undefined);
      assertEquals(mod.imports, []);

      const provider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === JWT_MODULE_OPTIONS,
      );
      assertExists(provider);
      assertEquals((provider as ValueProvider).useValue, options);
    });

    it("passes global flag through", () => {
      const mod = JwtModule.forRoot({ global: true });
      assertEquals(mod.global, true);
    });
  });

  describe("forRootAsync", () => {
    it("creates DynamicModule with useFactory provider and empty defaults", () => {
      const factory = () => ({ secret: "async" });
      const mod = JwtModule.forRootAsync({ useFactory: factory });

      assertEquals(mod.module, JwtModule);
      assertEquals(mod.global, undefined);
      assertEquals(mod.imports, []);

      const provider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === JWT_MODULE_OPTIONS,
      );
      assertExists(provider);
      assertEquals((provider as FactoryProvider).useFactory, factory);
      assertEquals((provider as FactoryProvider).inject, undefined);
    });

    it("passes inject tokens, imports, extraProviders and global flag", () => {
      const TOKEN = Symbol("TOKEN");
      const fakeImport = class {};
      const extra = { provide: "EXTRA", useValue: 42 } satisfies ValueProvider;
      const factory = () => ({});

      const mod = JwtModule.forRootAsync({
        global: true,
        imports: [fakeImport],
        inject: [TOKEN],
        useFactory: factory,
        extraProviders: [extra],
      });

      assertEquals(mod.global, true);
      assertEquals(mod.imports, [fakeImport]);

      const provider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === JWT_MODULE_OPTIONS,
      );
      assertEquals((provider as FactoryProvider).inject, [TOKEN]);
      assertEquals((provider as FactoryProvider).useFactory, factory);

      assertEquals(mod.providers!.includes(extra), true);
    });
  });
});
