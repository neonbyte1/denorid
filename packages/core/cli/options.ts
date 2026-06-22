/**
 * Allowed primitive types a single {@linkcode InputOption} value may take.
 */
export type InputOptionValue = string | number | boolean;

/**
 * Describes a single command-line option accepted by a {@linkcode ConsoleCommandInterface}.
 *
 * The shape mirrors Symfony's `InputOption`: every option has a long name (e.g.
 * `--force`) and may carry an optional one-character shortcut (e.g. `-f`).
 */
export interface InputOption {
  /** Long name (e.g. `force` for `--force`). MUST NOT contain whitespace. */
  name: string;
  /** Single character shortcut (e.g. `f` for `-f`). */
  shortcut?: string;
  /** Human-readable description shown in `--help` output. */
  description?: string;
  /**
   * Value type. Booleans never accept a value (treated as VALUE_NONE).
   *
   * @default "string"
   */
  type?: "boolean" | "string" | "number";
  /** When `true` the option may be repeated; the parsed value is an array. */
  array?: boolean;
  /** When `true` the option MUST be provided on the command line. */
  required?: boolean;
  /** Value applied when the option is omitted. Ignored for `required` options. */
  default?: InputOptionValue | InputOptionValue[];
}

/**
 * Metadata describing a `@ConsoleCommand`-decorated class.
 */
export interface CommandOptions {
  /** Fully-qualified command name, e.g. `cache:clear`. Used to resolve the command. */
  command: string;
  /** One-line description shown in command listings and the help header. */
  description?: string;
  /** Long-form help body printed by `--help`. */
  help?: string;
  /** Options accepted by the command. Merged with `@Option`-decorated entries. */
  options?: InputOption[];
}
