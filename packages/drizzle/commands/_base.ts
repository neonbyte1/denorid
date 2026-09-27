import type {
  ConsoleCommandInput,
  ConsoleCommandInterface,
} from "@denorid/core";
import childProcess from "node:child_process";
import process from "node:process";
import { DRIZZLE_KIT_PACKAGE } from "../_internal.ts";

/**
 * Minimal view of the runtime globals inspected to decide how `drizzle-kit`
 * is launched. Only the presence of each entry matters.
 *
 * @internal
 */
export interface DrizzleKitRuntimeGlobals {
  /** Defined when running on Deno. */
  readonly Deno?: unknown;
  /** Defined when running on Bun. */
  readonly Bun?: unknown;
}

/**
 * Executable, argument list and shell flag used to start `drizzle-kit`.
 */
interface DrizzleKitLauncher {
  /** Executable spawned as the child process. */
  readonly command: string;
  /** Arguments passed to {@linkcode DrizzleKitLauncher.command}. */
  readonly args: string[];
  /** Whether the child has to be started through the system shell. */
  readonly shell: boolean;
}

/**
 * Picks the launcher matching the current runtime.
 *
 * @param {string[]} kitArgs - `drizzle-kit` subcommand followed by its flags.
 * @param {DrizzleKitRuntimeGlobals} runtime - Runtime globals to inspect.
 * @param {string} platform - Operating system identifier (`process.platform`).
 * @returns {DrizzleKitLauncher} Launcher for the detected runtime.
 */
function resolveLauncher(
  kitArgs: string[],
  runtime: DrizzleKitRuntimeGlobals,
  platform: string,
): DrizzleKitLauncher {
  if (runtime.Deno !== undefined) {
    return {
      command: "deno",
      args: [
        "run",
        "-A",
        "--node-modules-dir",
        `npm:${DRIZZLE_KIT_PACKAGE}`,
        ...kitArgs,
      ],
      shell: false,
    };
  }

  if (runtime.Bun !== undefined) {
    return {
      command: process.execPath,
      args: ["x", DRIZZLE_KIT_PACKAGE, ...kitArgs],
      shell: false,
    };
  }

  return {
    command: "npx",
    args: ["--yes", DRIZZLE_KIT_PACKAGE, ...kitArgs],
    // `npx` is a `.cmd` shim on Windows, which Node.js refuses to spawn
    // without a shell.
    shell: platform === "win32",
  };
}

/**
 * Spawns `drizzle-kit` with inherited stdio through the launcher of the
 * current runtime and resolves to its exit code.
 *
 * - Deno: `deno run -A --node-modules-dir npm:drizzle-kit@<version> <args>`
 * - Bun: `<bun executable> x drizzle-kit@<version> <args>`
 * - Node.js: `npx --yes drizzle-kit@<version> <args>` (through the shell on
 *   Windows)
 *
 * `<version>` is the `drizzle-kit` release paired with the `drizzle-orm`
 * version this package depends on.
 *
 * @param {string[]} kitArgs - `drizzle-kit` subcommand followed by its flags.
 * @param {DrizzleKitRuntimeGlobals} [runtime] - Runtime globals used to detect
 *   the runtime; defaults to `globalThis`.
 * @param {string} [platform] - Operating system identifier; defaults to
 *   `process.platform`.
 * @returns {Promise<number>} Exit code of the child process, `1` when it was
 *   terminated by a signal.
 * @throws {Error} When the launcher executable cannot be spawned.
 *
 * @internal
 */
export function runDrizzleKit(
  kitArgs: string[],
  runtime: DrizzleKitRuntimeGlobals = globalThis as DrizzleKitRuntimeGlobals,
  platform: string = process.platform,
): Promise<number> {
  const { command, args, shell } = resolveLauncher(kitArgs, runtime, platform);

  return new Promise<number>((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      stdio: "inherit",
      shell,
    });

    child.once("error", reject);
    child.once("close", (code: number | null): void => resolve(code ?? 1));
  });
}

/**
 * Shared base class for every Drizzle CLI command shipped by this package.
 *
 * Concrete subclasses each represent a single `drizzle-kit` subcommand
 * (`generate`, `migrate`, ...). The base class owns the boilerplate of
 * spawning `drizzle-kit` on Deno, Bun or Node.js; subclasses only need to
 * translate the parsed {@linkcode ConsoleCommandInput} into the flag list the
 * underlying CLI expects.
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
   * @param {string} drizzleKitCommand - Name of the `drizzle-kit` subcommand
   *   to invoke, forwarded verbatim to the spawned process (e.g.
   *   `"generate"`, `"migrate"`).
   */
  protected constructor(protected readonly drizzleKitCommand: string) {}

  /**
   * Spawns `drizzle-kit` as a child process with inherited stdio and resolves
   * to its exit code.
   *
   * The launcher depends on the runtime executing the command:
   * - Deno: `deno run -A --node-modules-dir npm:drizzle-kit@<version> <command> ...`
   * - Bun: `bun x drizzle-kit@<version> <command> ...` (using the running
   *   executable)
   * - Node.js: `npx --yes drizzle-kit@<version> <command> ...`
   *
   * `<version>` is pinned to the release matching the `drizzle-orm` version
   * this package depends on.
   *
   * Flags produced by {@linkcode DrizzleCommand.buildCommandArguments} are
   * appended after the subcommand name.
   *
   * @param {ConsoleCommandInput} input - Parsed CLI options/arguments produced
   *   by the Denorid runner.
   * @returns {Promise<number>} Exit code reported by the `drizzle-kit` child
   *   process; `0` on success, `1` when it was terminated by a signal.
   * @throws {Error} When the launcher executable cannot be spawned.
   */
  public async execute(input: ConsoleCommandInput): Promise<number> {
    return await runDrizzleKit([
      this.drizzleKitCommand,
      ...this.buildCommandArguments(input),
    ]);
  }

  /**
   * Translates the parsed input into the flag list appended to the
   * `drizzle-kit` invocation.
   *
   * Implementations push one entry per token (e.g.
   * `["--config", "drizzle.config.ts"]`); the array is forwarded as an
   * argument list to the spawned process, so no shell quoting is required.
   * On Windows under Node.js `npx` is started through the shell, which joins
   * the tokens with spaces; tokens containing whitespace or shell
   * metacharacters are not preserved there.
   *
   * @param {ConsoleCommandInput} input - Parsed CLI options/arguments produced
   *   by the Denorid runner.
   * @returns {string[]} Flags appended after the `drizzle-kit` subcommand
   *   name.
   */
  protected abstract buildCommandArguments(
    input: ConsoleCommandInput,
  ): string[];
}
