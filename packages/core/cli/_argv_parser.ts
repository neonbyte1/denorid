import type { InputOption, InputOptionValue } from "./options.ts";

/**
 * Result of parsing a command's argv slice against its {@linkcode InputOption} list.
 */
export interface ParsedInput {
  /** Resolved option values keyed by long name. */
  options: Record<string, InputOptionValue | InputOptionValue[]>;
  /** Trailing positional arguments. Includes everything after `--`. */
  args: string[];
}

/**
 * Thrown by {@linkcode parseCommandArgs} when argv violates the option contract.
 *
 * The runner converts these into Symfony-style `[ERROR]` blocks rather than
 * propagating them to the command implementation.
 */
export class CommandParseError extends Error {
  public override readonly name = "CommandParseError";
}

interface IndexedOptions {
  byName: Map<string, InputOption>;
  byShortcut: Map<string, InputOption>;
}

/**
 * Pre-scan of an argv array that ignores option definitions.
 *
 * Used by the runner to identify the command name and pre-emptively honour the
 * global `--no-color` / `-h` / `--help` flags before any command-specific
 * parsing happens.
 */
export interface PreScannedArgv {
  /** First non-option token, or `undefined` when only flags were given. */
  commandName?: string;
  /** Tokens following the command name (passed to {@linkcode parseCommandArgs}). */
  rest: string[];
  /** Global `--no-color` flag was present anywhere on the line. */
  noColor: boolean;
  /** Global `-h` or `--help` flag was present anywhere on the line. */
  help: boolean;
}

/**
 * Performs a definition-free scan of `argv` to recover the command name and
 * any global flags.
 *
 * No option types are validated here; the scan only recognises the literal
 * global flags `--no-color`, `-h`, and `--help`. Everything else is returned
 * untouched in {@linkcode PreScannedArgv.rest}.
 *
 * @param {string[]} argv - Process argv without the binary name.
 * @returns {PreScannedArgv}
 */
export function preScanArgv(argv: string[]): PreScannedArgv {
  let commandName: string | undefined;
  const rest: string[] = [];
  let noColor = false;
  let help = false;
  let separatorSeen = false;

  for (const token of argv) {
    if (separatorSeen) {
      rest.push(token);
      continue;
    }

    if (token === "--") {
      separatorSeen = true;
      rest.push(token);

      continue;
    }

    if (token === "--no-color") {
      noColor = true;

      continue;
    }

    if (token === "--help" || token === "-h") {
      help = true;

      continue;
    }

    if (commandName === undefined && !token.startsWith("-")) {
      commandName = token;

      continue;
    }

    rest.push(token);
  }

  return { commandName, rest, noColor, help };
}

/**
 * Parses a per-command argv slice against the command's declared options.
 *
 * The implementation mirrors Symfony's `ArgvInput` rules:
 *  - `--name=value`, `--name value`, `-x value`, `-x=value`, `-xvz` (combined boolean shortcuts).
 *  - `--` ends option parsing; remaining tokens are appended to {@linkcode ParsedInput.args}.
 *  - Boolean options never take a value; non-boolean options always take exactly one.
 *  - Array options accept repeated occurrences (collected in declaration order).
 *
 * @param {string[]} argv - Argv slice belonging to the command (after the command name).
 * @param {InputOption[]} optionDefs - Options declared on the command.
 * @returns {ParsedInput} Resolved values with declared defaults applied.
 * @throws {CommandParseError} When argv violates the option contract.
 */
export function parseCommandArgs(
  argv: string[],
  optionDefs: InputOption[],
): ParsedInput {
  const index = indexOptions(optionDefs);
  const options: Record<string, InputOptionValue | InputOptionValue[]> = {};
  const args: string[] = [];

  let i = 0;
  let parseFlags = true;

  while (i < argv.length) {
    const token = argv[i];

    if (parseFlags && token === "--") {
      parseFlags = false;
      i += 1;

      continue;
    }

    if (parseFlags && token.startsWith("--") && token.length > 2) {
      i = consumeLongOption(argv, i, index, options);

      continue;
    }

    if (parseFlags && token.startsWith("-") && token.length > 1) {
      i = consumeShortOption(argv, i, index, options);

      continue;
    }

    args.push(token);
    i += 1;
  }

  applyDefaults(optionDefs, options);

  return { options, args };
}

function indexOptions(optionDefs: InputOption[]): IndexedOptions {
  const byName: Map<string, InputOption> = new Map();
  const byShortcut: Map<string, InputOption> = new Map();

  for (const opt of optionDefs) {
    if (byName.has(opt.name)) {
      throw new CommandParseError(
        `The "--${opt.name}" option is declared more than once.`,
      );
    }

    byName.set(opt.name, opt);

    if (opt.shortcut) {
      if (byShortcut.has(opt.shortcut)) {
        throw new CommandParseError(
          `The "-${opt.shortcut}" shortcut is declared more than once.`,
        );
      }
      byShortcut.set(opt.shortcut, opt);
    }
  }

  return { byName, byShortcut };
}

function consumeLongOption(
  argv: string[],
  index: number,
  defs: IndexedOptions,
  out: Record<string, InputOptionValue | InputOptionValue[]>,
): number {
  const token = argv[index];
  const eq = token.indexOf("=");
  const name = eq >= 0 ? token.slice(2, eq) : token.slice(2);
  const literal = eq >= 0 ? token.slice(eq + 1) : undefined;
  const def = defs.byName.get(name);

  if (!def) {
    throw new CommandParseError(`The "--${name}" option does not exist.`);
  }

  if (def.type === "boolean") {
    if (literal !== undefined) {
      throw new CommandParseError(
        `The "--${name}" option does not accept a value.`,
      );
    }

    record(out, def, true);
    return index + 1;
  }

  if (literal !== undefined) {
    record(out, def, cast(literal, def));
    return index + 1;
  }

  const next = argv[index + 1];

  if (next === undefined || next.startsWith("-")) {
    throw new CommandParseError(
      `The "--${name}" option requires a value.`,
    );
  }

  record(out, def, cast(next, def));
  return index + 2;
}

function consumeShortOption(
  argv: string[],
  index: number,
  defs: IndexedOptions,
  out: Record<string, InputOptionValue | InputOptionValue[]>,
): number {
  const token = argv[index];
  const body = token.slice(1);
  const eq = body.indexOf("=");

  if (eq >= 0) {
    const shortcut = body.slice(0, eq);
    const literal = body.slice(eq + 1);
    const def = defs.byShortcut.get(shortcut);

    if (!def) {
      throw new CommandParseError(
        `The "-${shortcut}" option does not exist.`,
      );
    }
    if (def.type === "boolean") {
      throw new CommandParseError(
        `The "-${shortcut}" option does not accept a value.`,
      );
    }

    record(out, def, cast(literal, def));
    return index + 1;
  }

  if (body.length === 1) {
    const def = defs.byShortcut.get(body);

    if (!def) {
      throw new CommandParseError(`The "-${body}" option does not exist.`);
    }

    if (def.type === "boolean") {
      record(out, def, true);
      return index + 1;
    }

    const next = argv[index + 1];
    if (next === undefined || next.startsWith("-")) {
      throw new CommandParseError(
        `The "-${body}" option requires a value.`,
      );
    }

    record(out, def, cast(next, def));
    return index + 2;
  }

  for (const ch of body) {
    const def = defs.byShortcut.get(ch);

    if (!def) {
      throw new CommandParseError(`The "-${ch}" option does not exist.`);
    }
    if (def.type !== "boolean") {
      throw new CommandParseError(
        `Cannot combine the "-${ch}" option with other flags because it requires a value.`,
      );
    }

    record(out, def, true);
  }

  return index + 1;
}

function record(
  out: Record<string, InputOptionValue | InputOptionValue[]>,
  def: InputOption,
  value: InputOptionValue,
): void {
  if (!def.array) {
    if (def.name in out) {
      throw new CommandParseError(
        `The "--${def.name}" option does not accept multiple values.`,
      );
    }

    out[def.name] = value;

    return;
  }

  const existing = out[def.name];

  if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    out[def.name] = [value];
  }
}

function cast(raw: string, def: InputOption): InputOptionValue {
  if (def.type === "number") {
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      throw new CommandParseError(
        `The "--${def.name}" option expects a numeric value, got "${raw}".`,
      );
    }

    return num;
  }

  return raw;
}

function applyDefaults(
  optionDefs: InputOption[],
  out: Record<string, InputOptionValue | InputOptionValue[]>,
): void {
  for (const def of optionDefs) {
    if (def.name in out) {
      continue;
    }

    if (def.required) {
      throw new CommandParseError(
        `The "--${def.name}" option is required.`,
      );
    }

    if (def.default !== undefined) {
      out[def.name] = def.default;

      continue;
    }

    if (def.type === "boolean") {
      out[def.name] = false;

      continue;
    }

    if (def.array) {
      out[def.name] = [];
    }
  }
}
