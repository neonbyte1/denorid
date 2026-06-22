import type { InjectorContext, Type } from "@denorid/injector";
import { CLI_COMMAND_METADATA } from "../_constants.ts";
import type { CommandSummary } from "./_help.ts";
import { getCommandMeta, getOptionsMeta } from "./_metadata.ts";
import type { ConsoleCommandInterface } from "./command_interface.ts";

/**
 * Resolved descriptor for a discovered console command.
 */
export interface CommandEntry extends CommandSummary {
  /** Class type used to resolve the singleton instance from the container. */
  token: Type<ConsoleCommandInterface>;
}

/**
 * Builds a name → {@linkcode CommandEntry} lookup by walking the container
 * tagged with {@linkcode CLI_COMMAND_METADATA}.
 *
 * The injector container's `getTokensByTag` already recurses into imported
 * modules, so commands defined inside microservice modules (which share the
 * same DI tree) surface here automatically.
 *
 * @param {InjectorContext} ctx - Bootstrapped injector context.
 * @returns {Map<string, CommandEntry>} Registry keyed by command name.
 *
 * @throws {Error} When two commands declare the same name.
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

    if (entries.has(meta.command)) {
      throw new Error(
        `Duplicate console command "${meta.command}" (registered by ${
          entries.get(meta.command)!.token.name
        } and ${type.name}).`,
      );
    }

    entries.set(meta.command, {
      token: type,
      name: meta.command,
      description: meta.description,
      help: meta.help,
      options: getOptionsMeta(type),
    });
  }

  return entries;
}
