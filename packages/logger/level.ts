/**
 * Defines the allowed log levels for a logger.
 */
export type LogLevel =
  | "debug" /**< Detailed debugging information. */
  | "verbose" /**< Informational messages for verbose output. */
  | "log" /**< Standard log messages. */
  | "warn" /**< Warnings that indicate potential issues. */
  | "error" /**< Error messages indicating failures. */
  | "fatal"; /**< Critical errors causing the application to terminate. */
