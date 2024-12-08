/**
 * Interface representing a logging service with various log levels.
 *
 * @template T - The return type of the logging methods. Defaults to `void`.
 */
export interface LoggerService<T = void> {
  /**
   * Logs a debug-level message.
   *
   * @param {unknown} message - The main message to log.
   * @param {...unknown[]} params - Additional parameters for the log message.
   * @returns {T} The return type of the log method, if applicable.
   */
  debug(
    message: unknown,
    ...params: unknown[]
  ): T;

  /**
   * Logs a verbose-level message.
   *
   * @param {unknown} message - The main message to log.
   * @param {...unknown[]} params - Additional parameters for the log message.
   * @returns {T} The return type of the log method, if applicable.
   */
  verbose(
    message: unknown,
    ...params: unknown[]
  ): T;

  /**
   * Logs a general information-level message.
   *
   * @param {unknown} message - The main message to log.
   * @param {...unknown[]} params - Additional parameters for the log message.
   * @returns {T} The return type of the log method, if applicable.
   */
  log(
    message: unknown,
    ...params: unknown[]
  ): T;

  /**
   * Logs a warning-level message.
   *
   * @param {unknown} message - The main message to log.
   * @param {...unknown[]} params - Additional parameters for the log message.
   * @returns {T} The return type of the log method, if applicable.
   */
  warn(
    message: unknown,
    ...params: unknown[]
  ): T;

  /**
   * Logs an error-level message.
   *
   * @param {unknown} message - The main message to log.
   * @param {...unknown[]} params - Additional parameters for the log message.
   * @returns {T} The return type of the log method, if applicable.
   */
  error(
    message: unknown,
    ...params: unknown[]
  ): T;

  /**
   * Logs a fatal-level message indicating a critical error or system failure.
   *
   * @param {unknown} message - The main message to log.
   * @param {...unknown[]} params - Additional parameters for the log message.
   * @returns {T} The return type of the log method, if applicable.
   */
  fatal(
    message: unknown,
    ...params: unknown[]
  ): T;
}
