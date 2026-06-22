import type { ConsoleCommandInput } from "@denorid/core";
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { DrizzleMigrateCommand } from "./migrations_migrate.ts";

/**
 * Subclass exposing the protected `buildCommandArguments` so every branch can
 * be hit directly.
 */
class HarnessedMigrate extends DrizzleMigrateCommand {
  public exposeBuildCommandArguments(input: ConsoleCommandInput): string[] {
    return this.buildCommandArguments(input);
  }
}

function build(options: ConsoleCommandInput["options"]): string[] {
  return new HarnessedMigrate().exposeBuildCommandArguments({
    args: [],
    options,
  });
}

describe("DrizzleMigrateCommand", () => {
  describe("buildCommandArguments", () => {
    it("returns no flags when --config is omitted", () => {
      assertEquals(build({}), []);
    });

    it("ignores --config when it isn't a string", () => {
      assertEquals(build({ config: true }), []);
      assertEquals(build({ config: 1 }), []);
    });

    it("forwards --config when it is a string", () => {
      assertEquals(build({ config: "drizzle.config.ts" }), [
        "--config",
        "drizzle.config.ts",
      ]);
    });
  });
});
