import type { Type } from "@denorid/injector";
import { CLI_COMMAND_METADATA, CLI_OPTIONS_METADATA } from "../_constants.ts";
import type { InputOption } from "./options.ts";

/**
 * Metadata stored by the `@ConsoleCommand` decorator on a command class.
 */
export interface ConsoleCommandMetadata {
  /** Command name (e.g. `cache:clear`). */
  command: string;
  /** Short description displayed in the command listing. */
  description?: string;
  /** Long help body printed by `--help`. */
  help?: string;
}

interface TypeWithMetadata {
  [Symbol.metadata]?: Record<symbol, unknown>;
}

/**
 * Reads {@linkcode ConsoleCommandMetadata} from a class constructor.
 *
 * @param {Type} target - Constructor of the command class.
 * @returns {ConsoleCommandMetadata|undefined} Metadata when the class was decorated, otherwise `undefined`.
 */
export function getCommandMeta(
  target: Type,
): ConsoleCommandMetadata | undefined {
  return (target as TypeWithMetadata)[Symbol.metadata]?.[
    CLI_COMMAND_METADATA
  ] as ConsoleCommandMetadata | undefined;
}

/**
 * Reads the declared {@linkcode InputOption} list from a class constructor.
 *
 * @param {Type} target - Constructor of the command class.
 * @returns {InputOption[]} Declared options; an empty array when none were registered.
 */
export function getOptionsMeta(target: Type): InputOption[] {
  const meta = (target as TypeWithMetadata)[Symbol.metadata]?.[
    CLI_OPTIONS_METADATA
  ] as InputOption[] | undefined;

  return meta ?? [];
}
