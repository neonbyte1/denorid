import {
  ConsoleCommand,
  type ConsoleCommandInput,
  isString,
} from "@denorid/core";
import { DrizzleCommand } from "./_base.ts";

/**
 * `migrations:generate` — wraps `drizzle-kit generate` to produce SQL migration
 * files from a Drizzle schema.
 *
 * Every option declared on the decorator maps 1:1 onto the corresponding
 * `drizzle-kit generate` flag, e.g. `--name`, `--config`, `--dialect`. String
 * options are only forwarded when explicitly provided; boolean flags
 * (`--breakpoints`, `--custom`) are only forwarded when truthy.
 *
 * @example Generate a migration via the Denorid CLI
 * ```bash
 * deno run -A cli.ts migrations:generate \
 *   --config drizzle.config.ts \
 *   --name add_users_table
 * ```
 */
@ConsoleCommand({
  command: "migrations:generate",
  options: [
    {
      name: "name",
      shortcut: "n",
      description: "Migration file name",
      type: "string",
      required: false,
    },
    {
      name: "config",
      description: "Path to drizzle config file",
      type: "string",
      required: false,
    },
    {
      name: "dialect",
      description:
        "Database dialect: 'gel', 'postgresql', 'mysql', 'sqlite', 'turso' or 'singlestore'",
      type: "string",
      required: false,
    },
    {
      name: "driver",
      description:
        "Database driver: 'd1-http', 'expo', 'aws-data-pi', 'pglite' or 'durable-sqlite'",
      type: "string",
      required: false,
    },
    {
      name: "casing",
      description: "Casing for serialization: 'camelCase' or 'snake_case'",
      type: "string",
      required: false,
    },
    {
      name: "schema",
      description: "Path to a schema file or folder",
      type: "string",
      required: false,
    },
    {
      name: "out",
      description: "Output folder, 'drizzle' by default",
      type: "string",
      required: false,
    },
    {
      name: "breakpoints",
      description: "Prepare SQL statements with breakpoints",
      type: "boolean",
      required: false,
    },
    {
      name: "custom",
      description:
        "Prepare empty migration file for custom SQL (default: false",
      type: "boolean",
      required: false,
    },
    {
      name: "prefix",
      description:
        "Default: 'index', available: 'index', 'timestamp', 'supabase', 'unix', 'none'",
      type: "string",
      required: false,
    },
  ],
})
export class DrizzleGenerateCommand extends DrizzleCommand {
  public constructor() {
    super("generate");
  }

  /**
   * Builds the flag list for `drizzle-kit generate`.
   *
   * @param input Parsed CLI options/arguments produced by the Denorid runner.
   * @returns Flags forwarded to `drizzle-kit generate`.
   */
  protected override buildCommandArguments(
    input: ConsoleCommandInput,
  ): string[] {
    const args: string[] = [];

    if (isString(input.options["config"])) {
      args.push("--config", input.options["config"]);
    }
    if (isString(input.options["name"])) {
      args.push("--name", input.options["name"]);
    }
    if (isString(input.options["dialect"])) {
      args.push("--dialect", input.options["dialect"]);
    }
    if (isString(input.options["driver"])) {
      args.push("--driver", input.options["driver"]);
    }
    if (isString(input.options["casing"])) {
      args.push("--casing", input.options["casing"]);
    }
    if (isString(input.options["schema"])) {
      args.push("--schema", input.options["schema"]);
    }
    if (isString(input.options["out"])) {
      args.push("--out", input.options["out"]);
    }
    if (input.options["breakpoints"]) {
      args.push("--breakpoints");
    }
    if (input.options["custom"]) {
      args.push("--custom");
    }

    return args;
  }
}
