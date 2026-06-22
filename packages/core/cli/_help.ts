import type { OutputFormatter } from "./_formatter.ts";
import type { InputOption, InputOptionValue } from "./options.ts";

/**
 * Lightweight view of a console command, sufficient for rendering help & listings.
 *
 * Pulled out of the full registry entry so the renderer doesn't need to know
 * about injection tokens or DI plumbing.
 */
export interface CommandSummary {
  name: string;
  description?: string;
  help?: string;
  options: InputOption[];
}

/**
 * Built-in options recognised by every command.
 *
 * Symfony's `Application` injects these into every `InputDefinition`; we do
 * the same so command authors never have to redeclare `--help` / `--no-color`.
 */
export const GLOBAL_OPTIONS: InputOption[] = [
  {
    name: "help",
    shortcut: "h",
    type: "boolean",
    description: "Display help for the given command",
  },
  {
    name: "no-color",
    type: "boolean",
    description: "Disable ANSI color output",
  },
];

/**
 * Renders Symfony-style `help` and `list` views for a {@linkcode CommandSummary}.
 */
export class HelpRenderer {
  /**
   * @param {OutputFormatter} formatter - Formatter used to colourise the rendered text.
   * @param {string} appName - Application name shown in the listing header.
   */
  public constructor(
    private readonly formatter: OutputFormatter,
    private readonly appName: string,
  ) {}

  /**
   * Builds the help block for a single command (`cmd --help`).
   *
   * @param {CommandSummary} summary - Command to describe.
   * @returns {string} Multi-line, formatted help text terminated with a newline.
   */
  public renderCommandHelp(summary: CommandSummary): string {
    const lines: string[] = [];
    const combinedOptions = [...summary.options, ...GLOBAL_OPTIONS];

    if (summary.description) {
      lines.push(this.formatter.format("<comment>Description:</comment>"));
      lines.push(`  ${summary.description}`);
      lines.push("");
    }

    lines.push(this.formatter.format("<comment>Usage:</comment>"));
    lines.push(`  ${summary.name} [options]`);
    lines.push("");

    lines.push(this.formatter.format("<comment>Options:</comment>"));
    for (const line of this.renderOptionTable(combinedOptions)) {
      lines.push(`  ${line}`);
    }

    if (summary.help) {
      lines.push("");
      lines.push(this.formatter.format("<comment>Help:</comment>"));
      for (const help of summary.help.split("\n")) {
        lines.push(`  ${help}`);
      }
    }

    lines.push("");

    return lines.join("\n");
  }

  /**
   * Builds the full command listing shown when no command is given (or via `list`).
   *
   * @param {CommandSummary[]} commands - Discovered commands; sorted internally by name.
   * @returns {string} Multi-line, formatted listing terminated with a newline.
   */
  public renderCommandList(commands: CommandSummary[]): string {
    const lines: string[] = [];

    lines.push(this.formatter.format(`<info>${this.appName}</info>`));
    lines.push("");

    lines.push(this.formatter.format("<comment>Usage:</comment>"));
    lines.push("  command [options] [arguments]");
    lines.push("");

    lines.push(this.formatter.format("<comment>Options:</comment>"));
    for (const line of this.renderOptionTable(GLOBAL_OPTIONS)) {
      lines.push(`  ${line}`);
    }
    lines.push("");

    lines.push(this.formatter.format("<comment>Available commands:</comment>"));

    if (commands.length === 0) {
      lines.push("  (no commands registered)");
      lines.push("");
      return lines.join("\n");
    }

    const grouped = groupByNamespace(commands);
    const nameWidth = commandColumnWidth(commands);

    const rootEntries = grouped.get(null);
    if (rootEntries) {
      for (const cmd of rootEntries) {
        lines.push(`  ${this.formatCommandRow(cmd, nameWidth)}`);
      }
    }

    for (const [namespace, group] of grouped) {
      if (namespace === null) {
        continue;
      }
      lines.push(this.formatter.format(` <comment>${namespace}</comment>`));
      for (const cmd of group) {
        lines.push(`  ${this.formatCommandRow(cmd, nameWidth)}`);
      }
    }

    lines.push("");

    return lines.join("\n");
  }

  private renderOptionTable(options: InputOption[]): string[] {
    const specs = options.map((opt) => ({ opt, spec: optionSpec(opt) }));
    const width = specs.reduce((acc, s) => Math.max(acc, s.spec.length), 0);

    return specs.map(({ opt, spec }) => {
      const colored = this.formatter.format(`<info>${spec}</info>`);
      const pad = " ".repeat(width - spec.length);
      const desc = opt.description ?? "";
      const suffix = formatDefaultSuffix(opt);
      return `${colored}${pad}  ${desc}${suffix}`.trimEnd();
    });
  }

  private formatCommandRow(cmd: CommandSummary, nameWidth: number): string {
    const colored = this.formatter.format(`<info>${cmd.name}</info>`);
    const pad = " ".repeat(nameWidth - cmd.name.length);
    const desc = cmd.description ?? "";
    return `${colored}${pad}  ${desc}`.trimEnd();
  }
}

function optionSpec(opt: InputOption): string {
  const head = opt.shortcut ? `-${opt.shortcut}, ` : "    ";

  if (opt.type === "boolean") {
    return `${head}--${opt.name}`;
  }

  return `${head}--${opt.name}=${opt.name.toUpperCase()}`;
}

function formatDefaultSuffix(opt: InputOption): string {
  const parts: string[] = [];

  if (opt.array) {
    parts.push("(multiple values allowed)");
  }

  if (opt.default !== undefined && opt.type !== "boolean") {
    parts.push(`(default: ${formatDefaultValue(opt.default)})`);
  }

  if (parts.length === 0) {
    return "";
  }

  return ` ${parts.join(" ")}`;
}

function formatDefaultValue(
  value: InputOptionValue | InputOptionValue[],
): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatDefaultValue(v)).join(", ")}]`;
  }

  if (typeof value === "string") {
    return `"${value}"`;
  }

  return String(value);
}

function groupByNamespace(
  commands: CommandSummary[],
): Map<string | null, CommandSummary[]> {
  const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));
  const groups: Map<string | null, CommandSummary[]> = new Map();

  for (const cmd of sorted) {
    const colon = cmd.name.indexOf(":");
    const namespace = colon >= 0 ? cmd.name.slice(0, colon) : null;
    const bucket = groups.get(namespace);

    if (bucket) {
      bucket.push(cmd);
    } else {
      groups.set(namespace, [cmd]);
    }
  }

  return groups;
}

function commandColumnWidth(commands: CommandSummary[]): number {
  let width = 0;

  for (const cmd of commands) {
    if (cmd.name.length > width) {
      width = cmd.name.length;
    }
  }

  return width;
}
