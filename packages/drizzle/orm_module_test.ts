import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { DrizzleOrmModule } from "./mod.ts";

describe("DrizzleOrmModule", () => {
  it("register should create a ValueProvider", () => {
    const dynamicModule = DrizzleOrmModule.register([]);

    assertExists(dynamicModule.providers);
    assertEquals(dynamicModule.providers!.length, 2);
    assertEquals(typeof dynamicModule.providers[0], "object");
    assertEquals("useValue" in dynamicModule.providers[0], true);
  });

  it("registerAsync should create a FactoryProvider", () => {
    const dynamicModule = DrizzleOrmModule.registerAsync({
      useFactory: () => [],
    });

    assertExists(dynamicModule.providers);
    assertEquals(dynamicModule.providers!.length, 2);
    assertEquals(typeof dynamicModule.providers[0], "object");
    assertEquals("useFactory" in dynamicModule.providers[0], true);
  });
});
