import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { ModuleCompiler } from "./_module_compiler.ts";
import { SimpleService } from "./_test_fixtures.ts";
import { Module } from "./decorators.ts";
import type { DynamicModule } from "./modules.ts";

describe("ModuleCompiler", () => {
  let compiler: ModuleCompiler;

  beforeEach(() => {
    compiler = new ModuleCompiler();
  });

  afterEach(() => {
    compiler.clear();
  });

  it("should cache dynamic modules", async () => {
    @Module({})
    class DynModule {
      static forRoot(): DynamicModule {
        return {
          module: DynModule,
          providers: [{ provide: "VALUE", useValue: 42 }],
        };
      }
    }

    const dynMod = DynModule.forRoot();
    const first = await compiler.compile(dynMod);
    const second = await compiler.compile(dynMod);

    assertEquals(first, second);
  });

  it("should cache regular modules", async () => {
    @Module({ providers: [SimpleService] })
    class CachedModule {}

    const first = await compiler.compile(CachedModule);
    const second = await compiler.compile(CachedModule);

    assertEquals(first, second);
  });

  it("should get modules in destroy order", async () => {
    @Module({ providers: [SimpleService] })
    class SubModule {}

    @Module({ imports: [SubModule] })
    class AppModule {}

    const compiled = await compiler.compile(AppModule);

    const initOrder = compiler.getModulesInInitOrder(compiled);
    const destroyOrder = compiler.getModulesInDestroyOrder(compiled);

    /** @note destroy order should be reverse of init order */

    assertEquals(destroyOrder.length, initOrder.length);
    assertEquals(destroyOrder[0], initOrder[initOrder.length - 1]);
    assertEquals(destroyOrder[destroyOrder.length - 1], initOrder[0]);
  });

  it("should clear cache", async () => {
    @Module({ providers: [SimpleService] })
    class ClearModule {}

    await compiler.compile(ClearModule);

    compiler.clear();

    const result = await compiler.compile(ClearModule);
    assertExists(result);
  });
});
