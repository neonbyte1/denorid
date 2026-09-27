import type { InjectorContext, Type } from "@denorid/injector";
import { CLI_COMMAND_METADATA } from "../_constants.ts";
import { type CommandSummary, GLOBAL_OPTIONS } from "./_help.ts";
import { getCommandMeta, getOptionsMeta } from "./_metadata.ts";
import type { ConsoleCommandInterface } from "./command_interface.ts";
import type { InputOption } from "./options.ts";

/**
 * Resolved descriptor for a discovered console command.
 */
export interface CommandEntry extends CommandSummary {
  /** Class type used to resolve the singleton instance from the container. */
  token: Type<ConsoleCommandInterface>;
}

/**
 * Builds a name to {@linkcode CommandEntry} lookup by walking the container
 * tagged with {@linkcode CLI_COMMAND_METADATA}.
 *
 * The injector container's `getTokensByTag` already recurses into imported
 * modules, so commands defined inside microservice modules (which share the
 * same DI tree) surface here automatically.
 *
 * @param {InjectorContext} ctx - Bootstrapped injector context.
 * @returns {Map<string, CommandEntry>} Registry keyed by command name.
 *
 * @throws {Error} When two commands declare the same name, a command uses the
 *   name of a built-in command (`list`, `help`), an empty name or a name
 *   starting with `-`, or declares an option name or shortcut twice or one of
 *   the global options (`--help`, `-h`, `--no-color`).
 */
export function buildCommandRegistry(
  ctx: InjectorContext,
): Map<string, CommandEntry> {
  const tokens = ctx.container.getTokensByTag(CLI_COMMAND_METADATA, true);
  const entries: Map<string, CommandEntry> = new Map();

  for (const token of tokens) {
    if (typeof token !== "function") {
      continue;
    }

    const type = token as Type<ConsoleCommandInterface>;
    const meta = getCommandMeta(type);

    if (!meta) {
      continue;
    }

    const label = `"${meta.command}" (${type.name})`;

    if (meta.command === "list" || meta.command === "help") {
      throw new Error(
        `Console command ${label} uses the name of a built-in command.`,
      );
    }

    if (meta.command === "" || meta.command.startsWith("-")) {
      throw new Error(
        `Console command ${label} needs a name that is not empty and does not start with "-".`,
      );
    }

    if (entries.has(meta.command)) {
      throw new Error(
        `Duplicate console command "${meta.command}" (registered by ${
          entries.get(meta.command)!.token.name
        } and ${type.name}).`,
      );
    }

    const options = getOptionsMeta(type);

    assertValidOptions(label, options);

    entries.set(meta.command, {
      token: type,
      name: meta.command,
      description: meta.description,
      help: meta.help,
      options,
    });
  }

  return entries;
}

/**
 * Throws when `options` declare a name or shortcut twice or reuse one of the
 * {@linkcode GLOBAL_OPTIONS}, which the runner adds to every command.
 *
 * @param {string} command - Command description used in error messages.
 * @param {InputOption[]} options - Options declared by the command.
 * @returns {void}
 * @throws {Error} When an option name or shortcut is taken.
 */
function assertValidOptions(command: string, options: InputOption[]): void {
  const names: Map<string, InputOption> = new Map();
  const shortcuts: Map<string, InputOption> = new Map();

  for (const option of [...GLOBAL_OPTIONS, ...options]) {
    const sameName = names.get(option.name);

    if (sameName) {
      throw new Error(
        GLOBAL_OPTIONS.includes(sameName)
          ? `Console command ${command} declares the "--${option.name}" option, which is reserved for the global "--${sameName.name}" option.`
          : `Console command ${command} declares the "--${option.name}" option more than once.`,
      );
    }

    names.set(option.name, option);

    if (!option.shortcut) {
      continue;
    }

    const sameShortcut = shortcuts.get(option.shortcut);

    if (sameShortcut) {
      throw new Error(
        GLOBAL_OPTIONS.includes(sameShortcut)
          ? `Console command ${command} declares the "-${option.shortcut}" shortcut, which is reserved for the global "--${sameShortcut.name}" option.`
          : `Console command ${command} declares the "-${option.shortcut}" shortcut more than once.`,
      );
    }

    shortcuts.set(option.shortcut, option);
  }
}
