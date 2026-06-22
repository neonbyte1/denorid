import type {
  ConsoleCommandInput,
  ConsoleCommandInterface,
} from "@denorid/core";

/**
 * Shared base class for every Drizzle CLI command shipped by this package.
 *
 * Concrete subclasses each represent a single `drizzle-kit` subcommand
 * (`generate`, `migrate`, …). The base class owns the boilerplate of
 * spawning `drizzle-kit` through Deno's npm interop; subclasses only need
 * to translate the parsed {@linkcode ConsoleCommandInput} into the flag
 * list the underlying CLI expects.
 *
 * @example Implementing a new command
 * ```ts
 * import { ConsoleCommand, type ConsoleCommandInput, isString } from "@denorid/core";
 * import { DrizzleCommand } from "@denorid/drizzle";
 *
 * \@ConsoleCommand({ command: "drizzle:push" })
 * export class DrizzlePushCommand extends DrizzleCommand {
 *   public constructor() {
 *     super("push");
 *   }
 *
 *   protected override buildCommandArguments(
 *     input: ConsoleCommandInput,
 *   ): string[] {
 *     return isString(input.options["config"])
 *       ? ["--config", input.options["config"]]
 *       : [];
 *   }
 * }
 * ```
 */
export abstract class DrizzleCommand implements ConsoleCommandInterface {
  /**
   * @param drizzleKitCommand Name of the `drizzle-kit` subcommand to invoke,
   *   forwarded verbatim to the spawned process (e.g. `"generate"`,
   *   `"migrate"`).
   */
  protected constructor(protected readonly drizzleKitCommand: string) {}

  /**
   * Spawns `drizzle-kit` as a child process with inherited stdio and resolves
   * to its exit code.
   *
   * The child is started via Deno's npm interop
   * (`deno run -A --node-modules-dir npm:drizzle-kit <command> …`) so users
   * do not need a separate Node.js toolchain installed. Flags produced by
   * {@linkcode DrizzleCommand.buildCommandArguments} are appended after the
   * subcommand name.
   *
   * @param input Parsed CLI options/arguments produced by the Denorid runner.
   * @returns Exit code reported by the `drizzle-kit` child process; `0` on
   *   success.
   */
  public async execute(input: ConsoleCommandInput): Promise<number> {
    const child = new Deno.Command("deno", {
      args: [
        "run",
        "-A",
        "--node-modules-dir",
        "npm:drizzle-kit",
        this.drizzleKitCommand,
        ...this.buildCommandArguments(input),
      ],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });

    const { code } = await child.output();

    return code;
  }

  /**
   * Translates the parsed input into the flag list appended to the
   * `drizzle-kit` invocation.
   *
   * Implementations push one entry per token (e.g.
   * `["--config", "drizzle.config.ts"]`); the array is forwarded as-is to
   * {@linkcode Deno.Command}, so no shell quoting is required.
   *
   * @param input Parsed CLI options/arguments produced by the Denorid runner.
   * @returns Flags appended after the `drizzle-kit` subcommand name.
   */
  protected abstract buildCommandArguments(
    input: ConsoleCommandInput,
  ): string[];
}
