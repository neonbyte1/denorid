/**
 * Contract for logger implementations used throughout Denorid.
 *
 * Implement this interface to provide a custom logger that can be passed to
 * {@linkcode Logger.overrideLogger}. Only `log`, `warn`, `fatal`, and `error`
 * are required; `debug` and `verbose` are optional.
 *
 * @template T Return type of each log method. Defaults to `void`.
 *
 * @example
 * ```ts
 * class MyLogger implements LoggerService {
 *   log(message: unknown, ...args: unknown[]): void { ... }
 *   warn(message: unknown, ...args: unknown[]): void { ... }
 *   fatal(message: unknown, ...args: unknown[]): void { ... }
 *   error(message: unknown, ...args: unknown[]): void { ... }
 * }
 * ```
 */
export interface LoggerService<T = void> {
  /** Logs an informational message. */
  log(message: unknown, ...optionalArgs: unknown[]): T;
  /** Logs a warning message. */
  warn(message: unknown, ...optionalArgs: unknown[]): T;
  /** Logs a fatal (unrecoverable) message. */
  fatal(message: unknown, ...optionalArgs: unknown[]): T;
  /** Logs an error message, optionally with a stack trace. */
  error(message: unknown, ...optionalArgs: unknown[]): T;
  /** Logs a debug message. Only called when the `"debug"` level is enabled. */
  debug?(message: unknown, ...optionalArgs: unknown[]): T;
  /** Logs a verbose message. Only called when the `"verbose"` level is enabled. */
  verbose?(message: unknown, ...optionalArgs: unknown[]): T;
}
