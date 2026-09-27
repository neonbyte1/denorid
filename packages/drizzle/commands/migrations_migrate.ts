import {
  ConsoleCommand,
  type ConsoleCommandInput,
  isString,
} from "@denorid/core";
import { DrizzleCommand } from "./_base.ts";

/**
 * `migrations:migrate` wraps `drizzle-kit migrate` to apply pending SQL
 * migrations against the configured database.
 *
 * Forwards `--config` and `--ignore-conflicts`; everything else is resolved by
 * `drizzle-kit` from the loaded config file.
 *
 * @example Apply pending migrations via the Denorid CLI
 * ```bash
 * deno run -A cli.ts migrations:migrate --config drizzle.config.ts
 * ```
 */
@ConsoleCommand({
  command: "migrations:migrate",
  options: [
    {
      name: "config",
      description: "Path to drizzle config file",
      type: "string",
      required: false,
    },
    {
      name: "ignore-conflicts",
      description: "Skip commutativity conflict checks",
      type: "boolean",
      required: false,
    },
  ],
})
export class DrizzleMigrateCommand extends DrizzleCommand {
  public constructor() {
    super("migrate");
  }

  /**
   * Builds the flag list for `drizzle-kit migrate`.
   *
   * @param input Parsed CLI options/arguments produced by the Denorid runner.
   * @returns Flags forwarded to `drizzle-kit migrate`.
   */
  protected override buildCommandArguments(
    input: ConsoleCommandInput,
  ): string[] {
    const args: string[] = [];

    if (isString(input.options["config"])) {
      args.push("--config", input.options["config"]);
    }
    if (input.options["ignore-conflicts"]) {
      args.push("--ignore-conflicts");
    }

    return args;
  }
}
