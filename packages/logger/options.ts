import type { InspectOptions } from "node:util";

/**
 * Severity levels supported by {@linkcode Logger}.
 *
 * From least to most verbose: `"fatal"`, `"error"`, `"warn"`, `"log"`,
 * `"debug"`, `"verbose"`.
 */
export type LogLevel =
  | "debug"
  | "verbose"
  | "log"
  | "warn"
  | "fatal"
  | "error";

/**
 * Configuration options for {@linkcode Logger}.
 *
 * All fields are optional; sensible defaults are applied when omitted.
 *
 * @example
 * ```ts
 * const logger = new Logger({
 *   context: "AppModule",
 *   levels: ["log", "warn", "error"],
 *   timestamp: true,
 *   colors: true,
 * });
 * ```
 */
export interface LoggerOptions {
  /** Default context label prepended to every message, e.g. `"AppModule"`. */
  context?: string;
  /**
   * Application name shown at the start of each line.
   * @default "Denorid"
   */
  prefix?: string;
  /**
   * Enabled log levels. Messages at levels not in this list are silently
   * dropped.
   * @default ["log", "warn", "error", "fatal"]
   */
  levels?: LogLevel[];
  /**
   * When `true`, appends the elapsed milliseconds since the previous message.
   * @default false
   */
  timestamp?: boolean;
  /**
   * Maximum depth used when inspecting nested objects.
   * @default 5
   */
  depth?: number;
  /**
   * Enable ANSI color codes in output.
   * @default true
   */
  colors?: boolean;
  /**
   * Emit structured JSON output instead of human-readable text.
   * @default false
   */
  json?: boolean;
  /**
   * Print objects on a single line. Automatically set to `true` when `json`
   * is `true`.
   * @default false
   */
  compact?: boolean;
  /**
   * Route all output through `console.log` / `console.error` instead of
   * writing directly to `Deno.stdout` / `Deno.stderr`.
   * @default false
   */
  forceConsole?: boolean;
  /**
   * Fine-grained options forwarded to Node's `util.inspect` when serialising
   * non-string values.
   */
  inspect?: Pick<
    InspectOptions,
    | "sorted"
    | "depth"
    | "breakLength"
    | "showHidden"
    | "maxArrayLength"
    | "maxStringLength"
  >;
}
