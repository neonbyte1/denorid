import { bold, cyan, green, magenta, red, yellow } from "@std/fmt/colors";
import type { LogLevel } from "./level.ts";
import type { LoggerService } from "./logger-service.ts";
import type { LoggerOptions } from "./options.ts";

/**
 * A utility function that applies both bold and red text formatting to a given string.
 *
 * @param str - The string to format with bold and red styling.
 *
 * @returns {string} - The input string wrapped in bold and red ANSI escape codes.
 *
 * @description
 * This function is typically used to format strings in a terminal or console log
 * with bold and red styling, often to highlight critical or error messages.
 * It combines two styles, making the text both bold and red.
 *
 * @example
 * ```ts
 * console.log(boldRed("Critical Error!"));
 * ```
 */
function boldRed(str: string): string {
  return bold(red(str));
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  day: "2-digit",
  month: "2-digit",
});

export class Logger implements LoggerService {
  /**
   * The global logger instance used for static log methods.
   * @private
   */
  private static globalLogger: Logger;

  /**
   * Configuration options for the logger instance.
   * @private
   */
  private readonly options: LoggerOptions;

  /**
   * Tracks the last log timestamp for computing time differences between log messages.
   * @private
   */
  private lastTimestamp?: number;

  /**
   * Creates a new `Logger` instance with optional context and configuration options.
   *
   * @param context - The context or scope of the logger, typically a module or component name.
   * @param options - Partial configuration for the logger.
   */
  public constructor(
    private readonly context: string | null,
    options?: Partial<LoggerOptions>,
  ) {
    this.options = {
      ...(options ?? {}),
      levels: [
        ...new Set(
          options?.levels ??
            [
              "debug",
              "verbose",
              "log",
              "warn",
              "error",
              "fatal",
            ] as LogLevel[],
        ),
      ],
    };
  }

  /**
   * Logs a debug  message.
   *
   * @param message - The message to log.
   * @param params - Additional arguments or objects to log.
   */
  public debug(
    message: unknown,
    ...params: unknown[]
  ): void {
    this.formatAndPrint("debug", message, null, ...params);
  }

  /**
   * Logs a verbose  message.
   *
   * @param message - The message to log.
   * @param params - Additional arguments or objects to log.
   */
  public verbose(
    message: unknown,
    ...params: unknown[]
  ): void {
    this.formatAndPrint("verbose", message, null, ...params);
  }

  /**
   * Logs a standard log  message.
   *
   * @param message - The message to log.
   * @param params - Additional arguments or objects to log.
   */
  public log(
    message: unknown,
    ...params: unknown[]
  ): void {
    this.formatAndPrint("log", message, null, ...params);
  }

  /**
   * Logs a warning message.
   *
   * @param message - The message to log.
   * @param params - Additional arguments or objects to log.
   */
  public warn(
    message: unknown,
    ...params: unknown[]
  ): void {
    this.formatAndPrint("warn", message, null, ...params);
  }

  /**
   * Logs an error message.
   *
   * @param message - The message to log.
   * @param params - Additional arguments or objects to log.
   */
  public error(
    message: unknown,
    ...params: unknown[]
  ): void {
    this.formatAndPrint("error", message, null, ...params);
  }

  /**
   * Logs a fatal error message, indicating critical errors.
   *
   * @param message - The message to log.
   * @param params - Additional arguments or objects to log.
   */
  public fatal(
    message: unknown,
    ...params: unknown[]
  ): void {
    this.formatAndPrint("fatal", message, null, ...params);
  }

  /**
   * Logs a debug-level message using the global logger instance.
   * This method is overloaded to allow specifying optional context and additional arguments.
   *
   * @param message - The main message to log. Can be a string, number, boolean, null, or undefined.
   * @param context - (Optional) The logging context, typically indicating the source or scope of the log.
   *                  If omitted, context may be part of `contextOrArgs`.
   * @param args - (Optional) Additional data to log alongside the message.
   *               Can be omitted if the second parameter is `contextOrArgs`.
   */
  public static debug(
    message: unknown,
    context: string,
    args?: unknown,
  ): void;
  /**
   * Logs a debug-level message using the global logger instance.
   * This overload allows for passing only a single context or additional argument.
   *
   * @param message - The main message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   */
  public static debug(
    message: unknown,
    contextOrArgs?: unknown,
  ): void;
  /**
   * Logs a debug-level message using the global logger instance.
   * This is the actual implementation that handles all overloads.
   *
   * @param message - The main message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   * @param args - Additional data to log alongside the message, if not already provided in `contextOrArgs`.
   */
  public static debug(
    message: unknown,
    contextOrArgs?: unknown,
    args?: unknown,
  ): void {
    this.formatAndPrint("debug", message, contextOrArgs, args);
  }

  /**
   * Logs a verbose-level message using the global logger instance.
   * This method is overloaded to allow specifying optional context and additional arguments.
   *
   * @param message - The main message to log. Can be a string, number, boolean, null, or undefined.
   * @param context - (Optional) The logging context, typically indicating the source or scope of the log.
   *                  If omitted, context may be part of `contextOrArgs`.
   * @param args - (Optional) Additional data to log alongside the message.
   *               Can be omitted if the second parameter is `contextOrArgs`.
   */
  public static verbose(
    message: unknown,
    context: string,
    args?: unknown,
  ): void;
  /**
   * Logs a verbose-level message using the global logger instance.
   * This overload allows for passing only a single context or additional argument.
   *
   * @param message - The main message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   */
  public static verbose(
    message: unknown,
    contextOrArgs?: unknown,
  ): void;
  /**
   * Logs a verbose-level message using the global logger instance.
   * This is the actual implementation that handles all overloads.
   *
   * @param message - The main message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   * @param args - Additional data to log alongside the message, if not already provided in `contextOrArgs`.
   */
  public static verbose(
    message: unknown,
    contextOrArgs?: unknown,
    args?: unknown,
  ): void {
    this.formatAndPrint("verbose", message, contextOrArgs, args);
  }

  /**
   * Logs a message at the "log" level using the global logger instance.
   * This method is overloaded to allow specifying optional context and additional arguments.
   *
   * @param message - The main message to log. Can be a string, number, boolean, null, or undefined.
   * @param context - (Optional) The logging context, typically indicating the source or scope of the log.
   *                  If omitted, context may be part of `contextOrArgs`.
   * @param args - (Optional) Additional data to log alongside the message.
   *               Can be omitted if the second parameter is `contextOrArgs`.
   */
  public static log(
    message: unknown,
    context: string,
    args?: unknown,
  ): void;
  /**
   * Logs a message at the "log" level using the global logger instance.
   * This overload allows for passing only a single context or additional argument.
   *
   * @param message - The main message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   */
  public static log(
    message: unknown,
    contextOrArgs?: unknown,
  ): void;
  /**
   * Logs a message at the "log" level using the global logger instance.
   * This is the actual implementation that handles all overloads.
   *
   * @param message - The main message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   * @param args - Additional data to log alongside the message, if not already provided in `contextOrArgs`.
   */
  public static log(
    message: unknown,
    contextOrArgs?: unknown,
    args?: unknown,
  ): void {
    this.formatAndPrint("log", message, contextOrArgs, args);
  }

  /**
   * Logs a warning message at the "warn" level using the global logger instance.
   * This method is overloaded to allow specifying optional context and additional arguments.
   *
   * @param message - The main warning message to log. Can be a string, number, boolean, null, or undefined.
   * @param context - (Optional) The logging context, typically indicating the source or scope of the log.
   *                  If omitted, context may be part of `contextOrArgs`.
   * @param args - (Optional) Additional data to log alongside the message.
   *               Can be omitted if the second parameter is `contextOrArgs`.
   */
  public static warn(
    message: unknown,
    context: string,
    args?: unknown,
  ): void;
  /**
   * Logs a warning message at the "warn" level using the global logger instance.
   * This overload allows for passing only a single context or additional argument.
   *
   * @param message - The main warning message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   */
  public static warn(
    message: unknown,
    contextOrArgs?: unknown,
  ): void;
  /**
   * Logs a warning message at the "warn" level using the global logger instance.
   * This is the actual implementation that handles all overloads.
   *
   * @param message - The main warning message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   * @param args - Additional data to log alongside the message, if not already provided in `contextOrArgs`.
   */
  public static warn(
    message: unknown,
    contextOrArgs?: unknown,
    args?: unknown,
  ): void {
    this.formatAndPrint("warn", message, contextOrArgs, args);
  }

  /**
   * Logs an error message at the "error" level using the global logger instance.
   * This method is overloaded to allow specifying optional context and additional arguments.
   *
   * @param message - The main error message to log. Can be a string, number, boolean, null, or undefined.
   * @param context - (Optional) The logging context, typically indicating the source or scope of the log.
   *                  If omitted, context may be part of `contextOrArgs`.
   * @param args - (Optional) Additional data to log alongside the message.
   *               Can be omitted if the second parameter is `contextOrArgs`.
   */
  public static error(
    message: unknown,
    context: string,
    args?: unknown,
  ): void;
  /**
   * Logs an error message at the "error" level using the global logger instance.
   * This overload allows for passing only a single context or additional argument.
   *
   * @param message - The main error message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   */
  public static error(
    message: unknown,
    contextOrArgs?: unknown,
  ): void;
  /**
   * Logs an error message at the "error" level using the global logger instance.
   * This is the actual implementation that handles all overloads.
   *
   * @param message - The main error message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   * @param args - Additional data to log alongside the message, if not already provided in `contextOrArgs`.
   */
  public static error(
    message: unknown,
    contextOrArgs?: unknown,
    args?: unknown,
  ): void {
    this.formatAndPrint("error", message, contextOrArgs, args);
  }

  /**
   * Logs a critical message at the "fatal" level using the global logger instance.
   * This method is overloaded to allow specifying optional context and additional arguments.
   *
   * @param message - The main critical message to log. Can be a string, number, boolean, null, or undefined.
   * @param context - (Optional) The logging context, typically indicating the source or scope of the log.
   *                  If omitted, context may be part of `contextOrArgs`.
   * @param args - (Optional) Additional data to log alongside the message.
   *               Can be omitted if the second parameter is `contextOrArgs`.
   */
  public static fatal(
    message: unknown,
    context: string,
    args?: unknown,
  ): void;
  /**
   * Logs a critical message at the "fatal" level using the global logger instance.
   * This overload allows for passing only a single context or additional argument.
   *
   * @param message - The main critical message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   */
  public static fatal(
    message: unknown,
    contextOrArgs?: unknown,
  ): void;
  /**
   * Logs a critical message at the "fatal" level using the global logger instance.
   * This is the actual implementation that handles all overloads.
   *
   * @param message - The main critical message to log.
   * @param contextOrArgs - Either the logging context (a string) or additional data to log.
   * @param args - Additional data to log alongside the message, if not already provided in `contextOrArgs`.
   */
  public static fatal(
    message: unknown,
    contextOrArgs?: unknown,
    args?: unknown,
  ): void {
    this.formatAndPrint("fatal", message, contextOrArgs, args);
  }

  /**
   * A private static method to format and print log messages. Delegates the actual work
   * to an instance of the global logger. If no global logger exists, one is initialized.
   *
   * @param level - The log level of the message. Determines the formatting and severity.
   * @param message - The primary content of the log message. Can be a string, number, boolean, null, or undefined.
   * @param contextOrArgs - Optional parameter that may represent the logging context (a string) or additional arguments.
   *                        If it is a string, it is treated as the context.
   * @param args - Optional parameter representing additional data to log, only used if `contextOrArgs` is not a string.
   */
  private static formatAndPrint(
    level: LogLevel,
    message: unknown,
    contextOrArgs?: unknown,
    args?: unknown,
  ): void {
    this.globalLogger ??= new Logger(null);
    this.globalLogger.formatAndPrint(
      level,
      message,
      typeof contextOrArgs === "string" ? contextOrArgs : null,
      args ?? (typeof contextOrArgs !== "string" ? contextOrArgs : null),
    );
  }

  /**
   * A private instance method to retrieve the appropriate color formatter for a given log level.
   * The color formatter function adds visual formatting to text based on the log level.
   *
   * @param level - The log level for which to retrieve the color formatter.
   * @returns A function that accepts a string and returns the colored version of the string.
   *          Default color (green) is returned for unknown log levels.
   */
  private getColorByLevel(level: LogLevel): (text: string) => string {
    switch (level) {
      case "debug":
        return magenta;
      case "verbose":
        return cyan;
      case "warn":
        return yellow;
      case "error":
        return red;
      case "fatal":
        return boldRed;
      default:
        return green;
    }
  }

  /**
   * A private instance method that calculates and returns the difference in time (in milliseconds)
   * since the last log was written. If a timestamp is enabled in the logger options, the method
   * includes the difference in the formatted output.
   *
   * @returns A string representing the time difference since the last log, formatted in milliseconds.
   *          If no timestamp is enabled or no previous timestamp exists, it returns an empty string.
   */
  private updateAndGetTimestampDiff(): string {
    const now = Date.now();
    const diff = this.options.timestamp && this.lastTimestamp
      ? yellow(` +${now - this.lastTimestamp}ms`)
      : "";

    this.lastTimestamp = now;

    return diff;
  }

  /**
   * A private instance method that determines whether the given data can be printed inline in the log message.
   * It checks whether the data is a simple primitive type (string, number, or boolean) or null/undefined.
   *
   * @param data - The data to check for inline printability. Can be of any type.
   * @returns `true` if the data can be printed inline (string, number, boolean, null, or undefined).
   *          `false` if the data is more complex (like objects or arrays).
   */
  private canInlineMessage(data: unknown): boolean {
    if (data === null || data === undefined) return true;

    switch (typeof data) {
      case "string":
      case "number":
      case "boolean":
        return true;
      default:
        return false;
    }
  }

  /**
   * A private instance method that formats and prints a log message to the console based on the provided log level.
   * The method handles message formatting, including timestamp, context, and arguments. It also ensures that
   * the message is logged with the appropriate color based on the log level and that it adheres to the logger's
   * configuration for verbosity and log levels.
   *
   * @param level - The log level that determines the severity of the log message. It can be one of:
   *   - "debug"
   *   - "verbose"
   *   - "log"
   *   - "warn"
   *   - "error"
   *   - "fatal"
   *
   * @param message - The main message to log. It can be a string, number, boolean, null, or undefined.
   *
   * @param staticContext - The context of the log, often representing the source of the log message. This is optional
   *                        and can be `null` or `undefined` if not provided.
   *
   * @param args - Additional arguments to print along with the message. Can be any type.
   *               These are printed after the main message unless they are inline (string, number, or boolean).
   *
   * @returns {void} - This method does not return any value. It outputs to the console.
   *
   * @description
   * This method is responsible for:
   * 1. Checking if the current log level is allowed by the logger's configuration.
   * 2. Formatting the log output with the appropriate color, timestamp, and context.
   * 3. Logging the message and its arguments in the correct format (inline or separate).
   * 4. Outputting the message to the console, using `console.log` for regular messages and `console.error` for "error"
   *    and "fatal" log levels.
   */
  private formatAndPrint(
    level: LogLevel,
    message: unknown,
    staticContext: string | undefined | null,
    args: unknown,
  ): void {
    if (this.options.levels.includes(level)) {
      const col = this.getColorByLevel(level);
      const context = staticContext ?? this.context;
      const write = level === "error" || level === "fatal"
        ? console.error
        : console.log;

      write(
        ([
          `${col(`[denorid] - ${Deno.pid} -`)}`,
          dateTimeFormatter.format(Date.now()),
          col(
            "".padEnd("verbose".length - level.length).concat(
              level.toUpperCase(),
            ),
          ),
          context ? yellow(`[${context}]`) : "",
          this.canInlineMessage(message) ? col(`${message}`) : "",
          args !== undefined && this.canInlineMessage(args)
            ? col(`${args}`)
            : "",
        ] as string[]).filter(({ length }: string) => length > 0).join(" "),
      );

      if (!this.canInlineMessage(message)) {
        write(message);
      }
      if (args !== undefined && !this.canInlineMessage(args)) {
        write(args);
      }
    }
  }
}
