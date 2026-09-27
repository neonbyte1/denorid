import type { ConsoleCommandInput } from "@denorid/core";
import { assertEquals } from "@std/assert";
import { describe, it } from "node:test";
import { DrizzleGenerateCommand } from "./migrations_generate.ts";

/**
 * Tiny subclass that exposes the protected `buildCommandArguments` so we can
 * exercise every branch without going through `execute` and stubbing
 * `childProcess.spawn`.
 */
class HarnessedGenerate extends DrizzleGenerateCommand {
  public exposeBuildCommandArguments(input: ConsoleCommandInput): string[] {
    return this.buildCommandArguments(input);
  }
}

function build(
  options: ConsoleCommandInput["options"],
  args: string[] = [],
): string[] {
  return new HarnessedGenerate().exposeBuildCommandArguments({
    args,
    options,
  });
}

describe("DrizzleGenerateCommand", () => {
  describe("buildCommandArguments", () => {
    it("returns no flags when no options are provided", () => {
      assertEquals(build({}), []);
    });

    it("ignores non-string values for the string-typed flags", () => {
      assertEquals(
        build({
          config: true,
          name: 42,
          dialect: false,
          driver: 0,
          schema: null as unknown as string,
          out: [] as unknown as string,
        }),
        [],
      );
    });

    it("forwards every string option in declaration order", () => {
      assertEquals(
        build({
          config: "drizzle.config.ts",
          name: "init",
          dialect: "postgresql",
          driver: "pglite",
          schema: "./db/schema.ts",
          out: "./drizzle",
        }),
        [
          "--config",
          "drizzle.config.ts",
          "--name",
          "init",
          "--dialect",
          "postgresql",
          "--driver",
          "pglite",
          "--schema",
          "./db/schema.ts",
          "--out",
          "./drizzle",
        ],
      );
    });

    it("emits boolean flags only when truthy", () => {
      assertEquals(
        build({
          breakpoints: true,
          custom: true,
          "ignore-conflicts": true,
          explain: true,
        }),
        ["--breakpoints", "--custom", "--ignore-conflicts", "--explain"],
      );
      assertEquals(
        build({
          breakpoints: false,
          custom: false,
          "ignore-conflicts": false,
          explain: false,
        }),
        [],
      );
    });

    it("combines string and boolean options together", () => {
      assertEquals(
        build({
          config: "drizzle.config.ts",
          breakpoints: true,
          custom: false,
        }),
        ["--config", "drizzle.config.ts", "--breakpoints"],
      );
    });
  });
});
