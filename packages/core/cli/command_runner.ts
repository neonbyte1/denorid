import type { InjectorContext } from "@denorid/injector";
import {
  CommandParseError,
  parseCommandArgs,
  preScanArgv,
} from "./_argv_parser.ts";
import { OutputFormatter, shouldDecorate } from "./_formatter.ts";
import { type CommandSummary, GLOBAL_OPTIONS, HelpRenderer } from "./_help.ts";
import { buildCommandRegistry, type CommandEntry } from "./_registry.ts";
import type { ConsoleCommandInterface } from "./command_interface.ts";

/**
 * Minimal writable surface used by {@linkcode ConsoleCommandRunner}.
 *
 * Matches `Deno.stdout` / `Deno.stderr` and is intentionally narrow so tests
 * can supply an in-memory buffer.
 */
export interface ConsoleWriter {
  write(p: Uint8Array): number | Promise<number>;
}

/**
 * Options accepted by {@linkcode ConsoleCommandRunner}.
 */
export interface ConsoleCommandRunnerOptions {
  /** Application name displayed in the listing header. Defaults to `"Denorid"`. */
  appName?: string;
  /** stdout-like target. Defaults to `Deno.stdout`. */
  stdout?: ConsoleWriter;
  /** stderr-like target. Defaults to `Deno.stderr`. */
  stderr?: ConsoleWriter;
  /** Force-enable / disable ANSI escapes. When omitted, auto-detected. */
  decorated?: boolean;
}

/**
 * Orchestrates console command discovery, argv parsing and execution.
 *
 * The runner is intentionally framework-agnostic: it owns the `InjectorContext`
 * only for the duration of a {@linkcode ConsoleCommandRunner.run} call and
 * never starts/stops the application lifecycle (that's the caller's job).
 */
export class ConsoleCommandRunner {
  private readonly ctx: InjectorContext;
  private readonly registry: Map<string, CommandEntry>;
  private readonly formatter: OutputFormatter;
  private readonly help: HelpRenderer;
  private readonly stdout: ConsoleWriter;
  private readonly stderr: ConsoleWriter;
  private readonly encoder: TextEncoder = new TextEncoder();

  /**
   * @param {InjectorContext} ctx - Bootstrapped injector context containing the command tokens.
   * @param {ConsoleCommandRunnerOptions} [options] - Optional configuration overrides.
   */
  public constructor(
    ctx: InjectorContext,
    options: ConsoleCommandRunnerOptions = {},
  ) {
    this.ctx = ctx;
    this.registry = buildCommandRegistry(ctx);
    this.formatter = new OutputFormatter(options.decorated ?? shouldDecorate());
    this.help = new HelpRenderer(this.formatter, options.appName ?? "Denorid");
    this.stdout = options.stdout ?? Deno.stdout;
    this.stderr = options.stderr ?? Deno.stderr;
  }

  /**
   * Executes the command line described by `argv`.
   *
   * Resolution rules (mirroring Symfony):
   *  - No command, `--help`, or `list` → render the command list, exit `0`.
   *  - `help <name>` → render help for `<name>`.
   *  - `<name> --help` / `<name> -h` → render help for `<name>`.
   *  - Otherwise → resolve the command and call `execute`.
   *
   * The global `--no-color` flag is honoured anywhere on the command line and
   * takes effect for help/error output as well as the command body.
   *
   * @param {string[]} argv - Argv slice excluding the program name (i.e. `Deno.args`).
   * @returns {Promise<number>} Exit code (0 = success).
   */
  public async run(argv: string[]): Promise<number> {
    const pre = preScanArgv(argv);

    if (pre.noColor) {
      this.formatter.decorated = false;
    }

    if (!pre.commandName) {
      await this.write(
        this.stdout,
        this.help.renderCommandList(this.summary()),
      );
      return 0;
    }

    if (pre.commandName === "list") {
      await this.write(
        this.stdout,
        this.help.renderCommandList(this.summary()),
      );
      return 0;
    }

    if (pre.commandName === "help") {
      return await this.runHelpCommand(pre.rest);
    }

    const entry = this.registry.get(pre.commandName);

    if (!entry) {
      await this.writeError(`Command "${pre.commandName}" is not defined.`);
      await this.writeSuggestions(pre.commandName);
      return 1;
    }

    if (pre.help) {
      await this.write(this.stdout, this.help.renderCommandHelp(entry));
      return 0;
    }

    return await this.executeCommand(entry, pre.rest);
  }

  private async runHelpCommand(rest: string[]): Promise<number> {
    const target = rest.find((token) => !token.startsWith("-"));

    if (!target) {
      await this.write(
        this.stdout,
        this.help.renderCommandList(this.summary()),
      );
      return 0;
    }

    const entry = this.registry.get(target);

    if (!entry) {
      await this.writeError(`Command "${target}" is not defined.`);
      return 1;
    }

    await this.write(this.stdout, this.help.renderCommandHelp(entry));
    return 0;
  }

  private async executeCommand(
    entry: CommandEntry,
    rest: string[],
  ): Promise<number> {
    const allOptions = [...entry.options, ...GLOBAL_OPTIONS];
    let parsed;

    try {
      parsed = parseCommandArgs(rest, allOptions);
    } catch (error) {
      if (error instanceof CommandParseError) {
        await this.writeError(error.message);
        await this.write(this.stdout, this.help.renderCommandHelp(entry));
        return 1;
      }
      throw error;
    }

    const instance = await this.ctx.resolveInternal<ConsoleCommandInterface>(
      entry.token,
    );

    try {
      const code = await instance.execute({
        options: parsed.options,
        args: parsed.args,
      });
      return typeof code === "number" ? code : 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.writeError(message);

      if (error instanceof Error && error.stack) {
        await this.write(this.stderr, `${error.stack}\n`);
      }

      return 1;
    }
  }

  private summary(): CommandSummary[] {
    return [...this.registry.values()];
  }

  private async writeError(message: string): Promise<void> {
    const block = this.formatter.format(`<error> [ERROR] ${message} </error>`);
    await this.write(this.stderr, `\n${block}\n\n`);
  }

  private async writeSuggestions(name: string): Promise<void> {
    const candidates = [...this.registry.keys()].filter((known) =>
      known.startsWith(name) || name.startsWith(known) ||
      sharesNamespace(known, name)
    );

    if (candidates.length === 0) {
      return;
    }

    candidates.sort();

    const lines = [
      this.formatter.format("<comment>Did you mean one of these?</comment>"),
      ...candidates.map((c) => `    ${c}`),
      "",
    ];

    await this.write(this.stderr, `${lines.join("\n")}\n`);
  }

  private async write(target: ConsoleWriter, text: string): Promise<void> {
    const bytes = this.encoder.encode(text);
    let offset = 0;

    while (offset < bytes.length) {
      const written = await target.write(bytes.subarray(offset));
      offset += written;
    }
  }
}

function sharesNamespace(a: string, b: string): boolean {
  const colonA = a.indexOf(":");
  const colonB = b.indexOf(":");

  return colonA > 0 && colonB > 0 && a.slice(0, colonA) === b.slice(0, colonB);
}
