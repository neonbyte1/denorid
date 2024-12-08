import type { LogLevel } from "./level.ts";

/**
 * Configuration options for a logger.
 */
export interface LoggerOptions {
  /**
   * Specifies the log levels that the logger should handle.
   *
   * @type {LogLevel[]}
   */
  levels: LogLevel[];

  /**
   * Whether to include the timestamp difference in log messages.
   *
   * @type {boolean | undefined}
   * @defaultValue `false`
   */
  timestamp?: boolean;
}
