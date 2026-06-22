import type { Decorator } from "@denorid/injector";
import { Injectable, Tags } from "@denorid/injector";
import { CLI_COMMAND_METADATA, CLI_OPTIONS_METADATA } from "../_constants.ts";
import type { ConsoleCommandMetadata } from "./_metadata.ts";
import type { CommandOptions, InputOption } from "./options.ts";

/**
 * Marks a class as a console command.
 *
 * The decorator additionally registers the class as a singleton injectable and
 * tags it with {@linkcode CLI_COMMAND_METADATA} so the runner can discover it
 * through the dependency-injection container.
 *
 * @param {CommandOptions} options - Command metadata (name, description, help, default options).
 * @returns {Decorator<ClassDecoratorContext>}
 */
export function ConsoleCommand(
  options: CommandOptions,
): Decorator<ClassDecoratorContext> {
  return (target: unknown, ctx: ClassDecoratorContext): void => {
    Injectable({ mode: "singleton" })(target, ctx);
    Tags(CLI_COMMAND_METADATA)(target, ctx);

    ctx.metadata[CLI_COMMAND_METADATA] = {
      command: options.command,
      description: options.description,
      help: options.help,
    } satisfies ConsoleCommandMetadata;

    if (options.options && options.options.length > 0) {
      const existing =
        (ctx.metadata[CLI_OPTIONS_METADATA] ?? []) as InputOption[];

      ctx.metadata[CLI_OPTIONS_METADATA] = [...options.options, ...existing];
    }
  };
}

/**
 * Declares a single {@linkcode InputOption} for the decorated class.
 *
 * Multiple `@Option` decorators stack; they are merged with the `options` array
 * passed to `@ConsoleCommand` when the command is resolved.
 *
 * @param {InputOption} option - Option metadata.
 * @returns {Decorator<ClassDecoratorContext>}
 */
export function Option(option: InputOption): Decorator<ClassDecoratorContext> {
  return (_: unknown, ctx: ClassDecoratorContext): void => {
    const existing =
      (ctx.metadata[CLI_OPTIONS_METADATA] ??= []) as InputOption[];

    existing.unshift(option);
  };
}
