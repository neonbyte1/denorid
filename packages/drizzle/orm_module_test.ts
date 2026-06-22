import { assertArrayIncludes, assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { DrizzleGenerateCommand } from "./commands/migrations_generate.ts";
import { DrizzleMigrateCommand } from "./commands/migrations_migrate.ts";
import { DrizzleService } from "./drizzle_service.ts";
import { DrizzleOrmModule } from "./mod.ts";

describe("DrizzleOrmModule", () => {
  it("register should create a ValueProvider", () => {
    const dynamicModule = DrizzleOrmModule.register([]);

    assertExists(dynamicModule.providers);
    assertEquals(dynamicModule.providers!.length, 4);
    assertEquals(typeof dynamicModule.providers[0], "object");
    assertEquals("useValue" in dynamicModule.providers[0], true);
  });

  it("register should export DrizzleService and CLI commands", () => {
    const dynamicModule = DrizzleOrmModule.register([]);

    assertExists(dynamicModule.exports);
    assertArrayIncludes(dynamicModule.exports!, [
      DrizzleService,
      DrizzleGenerateCommand,
      DrizzleMigrateCommand,
    ]);
  });

  it("registerAsync should create a FactoryProvider", () => {
    const dynamicModule = DrizzleOrmModule.registerAsync({
      useFactory: () => [],
    });

    assertExists(dynamicModule.providers);
    assertEquals(dynamicModule.providers!.length, 4);
    assertEquals(typeof dynamicModule.providers[0], "object");
    assertEquals("useFactory" in dynamicModule.providers[0], true);
  });

  it("registerAsync should export DrizzleService and CLI commands", () => {
    const dynamicModule = DrizzleOrmModule.registerAsync({
      useFactory: () => [],
    });

    assertExists(dynamicModule.exports);
    assertArrayIncludes(dynamicModule.exports!, [
      DrizzleService,
      DrizzleGenerateCommand,
      DrizzleMigrateCommand,
    ]);
  });
});
