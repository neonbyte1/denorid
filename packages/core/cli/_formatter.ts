/**
 * 16-colour palette recognised by {@linkcode OutputFormatter}.
 *
 * `default` resolves to the terminal's configured foreground / background.
 */
export type AnsiColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "default";

/**
 * Text effects recognised by {@linkcode OutputFormatter}.
 */
export type AnsiEffect = "bold" | "dim" | "italic" | "underline";

/**
 * Colour + effect bundle bound to a Symfony-style tag name.
 */
export interface StyleDefinition {
  fg?: AnsiColor;
  bg?: AnsiColor;
  effects?: AnsiEffect[];
}

const FG_CODES: Record<AnsiColor, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  default: 39,
};

const BG_CODES: Record<AnsiColor, number> = {
  black: 40,
  red: 41,
  green: 42,
  yellow: 43,
  blue: 44,
  magenta: 45,
  cyan: 46,
  white: 47,
  default: 49,
};

const EFFECT_CODES: Record<AnsiEffect, number> = {
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
};

/**
 * Default Symfony-compatible style palette.
 *
 * Mirrors `Symfony\\Component\\Console\\Formatter\\OutputFormatter`'s
 * factory defaults: `info`, `error`, `comment`, `question`, plus the
 * commonly-seen `success` / `warning` extensions used by `SymfonyStyle`.
 */
export const DEFAULT_STYLES: Record<string, StyleDefinition> = {
  info: { fg: "green" },
  error: { fg: "white", bg: "red" },
  comment: { fg: "yellow" },
  question: { fg: "black", bg: "cyan" },
  success: { fg: "black", bg: "green" },
  warning: { fg: "black", bg: "yellow" },
};

const TAG_PATTERN: RegExp = /<(\/?)([a-zA-Z][a-zA-Z0-9_-]*)>/g;

/**
 * Decides whether ANSI escapes should be emitted to stdout/stderr by default.
 *
 * Honours the `NO_COLOR` environment variable (https://no-color.org) and
 * downgrades to plain output when stdout is not attached to a TTY.
 *
 * @returns {boolean} `true` when the terminal accepts ANSI escapes.
 */
export function shouldDecorate(): boolean {
  if (Deno.env.get("NO_COLOR") !== undefined) {
    return false;
  }

  try {
    return Deno.stdout.isTerminal();
  } catch {
    return false;
  }
}

/**
 * Parses Symfony-style markup (`<info>…</info>`) and replaces tags with ANSI
 * escape sequences.
 *
 * Unknown tags are emitted verbatim so callers may safely format text that
 * happens to contain `<...>` literals. Nesting is supported and inner tags
 * override outer ones segment by segment.
 */
export class OutputFormatter {
  /** When `false` all markup is stripped and no ANSI escapes are emitted. */
  public decorated: boolean;

  private readonly styles: Map<string, StyleDefinition>;

  /**
   * @param {boolean} decorated - Whether ANSI escapes should be emitted.
   * @param {Record<string, StyleDefinition>} [styles] - Style palette; defaults to {@linkcode DEFAULT_STYLES}.
   */
  public constructor(
    decorated: boolean,
    styles: Record<string, StyleDefinition> = DEFAULT_STYLES,
  ) {
    this.decorated = decorated;
    this.styles = new Map(Object.entries(styles));
  }

  /**
   * Adds or overrides a named style.
   *
   * @param {string} name - Tag name (e.g. `error`).
   * @param {StyleDefinition} style - Style definition applied to text inside the tag.
   */
  public setStyle(name: string, style: StyleDefinition): void {
    this.styles.set(name, style);
  }

  /**
   * Convenience wrapper that applies a named style to a plain string.
   *
   * @param {string} text - Plain text.
   * @param {string} styleName - Registered style name.
   * @returns {string} `text` wrapped in ANSI escapes when decorated, otherwise unchanged.
   */
  public apply(text: string, styleName: string): string {
    const style = this.styles.get(styleName);
    if (!style || !this.decorated) {
      return text;
    }

    return this.wrap(text, style);
  }

  /**
   * Formats markup-bearing input, replacing recognised tags with ANSI escapes
   * (when decorated) or stripping them (when not).
   *
   * @param {string} input - Source text containing zero or more `<style>…</style>` segments.
   * @returns {string} Rendered output.
   */
  public format(input: string): string {
    let cursor = 0;
    let output = "";
    const stack: StyleDefinition[] = [];

    TAG_PATTERN.lastIndex = 0;

    for (;;) {
      const match = TAG_PATTERN.exec(input);
      if (!match) {
        break;
      }

      const [full, slash, name] = match;
      const segment = input.slice(cursor, match.index);

      if (segment.length > 0) {
        output += this.renderSegment(segment, stack);
      }

      if (slash === "/") {
        if (stack.length > 0) {
          stack.pop();
        } else {
          output += full;
        }
      } else if (this.styles.has(name)) {
        stack.push(this.styles.get(name)!);
      } else {
        output += full;
      }

      cursor = TAG_PATTERN.lastIndex;
    }

    const tail = input.slice(cursor);
    if (tail.length > 0) {
      output += this.renderSegment(tail, stack);
    }

    return output;
  }

  private renderSegment(text: string, stack: StyleDefinition[]): string {
    if (!this.decorated || stack.length === 0) {
      return text;
    }

    return this.wrap(text, this.collapse(stack));
  }

  private collapse(stack: StyleDefinition[]): StyleDefinition {
    let fg: AnsiColor | undefined;
    let bg: AnsiColor | undefined;
    const effects: Set<AnsiEffect> = new Set();

    for (const style of stack) {
      if (style.fg) {
        fg = style.fg;
      }
      if (style.bg) {
        bg = style.bg;
      }
      if (style.effects) {
        for (const effect of style.effects) {
          effects.add(effect);
        }
      }
    }

    return { fg, bg, effects: effects.size > 0 ? [...effects] : undefined };
  }

  private wrap(text: string, style: StyleDefinition): string {
    const codes: number[] = [];

    if (style.fg) {
      codes.push(FG_CODES[style.fg]);
    }
    if (style.bg) {
      codes.push(BG_CODES[style.bg]);
    }
    if (style.effects) {
      for (const effect of style.effects) {
        codes.push(EFFECT_CODES[effect]);
      }
    }

    if (codes.length === 0) {
      return text;
    }

    return `\x1b[${codes.join(";")}m${text}\x1b[0m`;
  }
}
