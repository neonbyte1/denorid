import {
  bold,
  brightCyan,
  brightMagenta,
  green,
  red,
  yellow,
} from "@std/fmt/colors";
import { inspect, type InspectOptions } from "node:util";
import {
  dateTimeFormatter,
  DEFAULT_DEPTH,
  isPlainObject,
} from "./_internal.ts";
import type { LoggerService } from "./logger_service.ts";
import type { LoggerOptions, LogLevel } from "./options.ts";

const boldRed = (str: string): string => bold(red(str));

const STATIC_LOGGER_INSTANCE = Symbol.for("drizzle.static_logger");

/** Options passed internally to {@linkcode Logger.printMessages} and {@linkcode Logger.printAsJson}. */
export interface PrintMessageOptions {
  /** Optional context label for this message. */
  context?: string;
  /** Severity level of the message. */
  level: LogLevel;
  /** When `true` the message is written to stderr. */
  shouldUseStderr: boolean;
  /** Error stack trace string, included in JSON output as `"stack"`. */
  errorStack?: unknown;
}

/** Shape of a single log entry when `json: true` is set in {@linkcode LoggerOptions}. */
export interface JsonLogObject {
  /** Severity level. */
  level: LogLevel;
  /** Process ID (`Deno.pid`). */
  pid: number;
  /** Unix epoch milliseconds at the time of the call. */
  timestamp: number;
  /** Optional context label. */
  context?: string;
  /** The logged value. */
  message: unknown;
  /** Error stack trace, present only for `error` messages that include one. */
  stack?: unknown;
}

/** Parsed result of splitting log arguments into messages and an optional context label. */
export interface MessageContext {
  /** The values to be logged. */
  messages: unknown[];
  /** Context label extracted from the last argument, or the instance default. */
  context: string | undefined;
}

/** Extends {@linkcode MessageContext} with an optional error stack trace. */
export interface StackMessageContext extends MessageContext {
  /** Error stack trace string, used by the `error` level. */
  stack?: string;
}

// deno-lint-ignore no-explicit-any
type ArgsWithOptionalContext = [...any, string?];

/**
 * A versatile logger designed for both standalone use and integration with Denorid applications.
 *
 * Supports colorised human-readable output and structured JSON output.
 * Can be used as a static singleton or instantiated per module with a
 * dedicated context label.
 *
 * @example Basic usage
 * ```ts
 * // Static singleton
 * Logger.log("Server started", "Bootstrap");
 * Logger.error("Something went wrong", err.stack, "AppModule");
 *
 * // Per-module instance
 * const logger = new Logger("MyService");
 * logger.log("Initialised");
 * logger.warn("Low memory");
 * ```
 *
 * @example JSON output
 * ```ts
 * const logger = new Logger({ json: true, compact: true });
 * logger.log({ userId: 1, action: "login" });
 * // {"level":"log","pid":12345,"timestamp":1712345678000,"message":{"userId":1,"action":"login"}}
 * ```
 */
export class Logger implements LoggerService {
  /** Backing store for the lazily-created static singleton {@linkcode Logger.staticInstanceRef}. */
  private static [STATIC_LOGGER_INSTANCE]?: LoggerService;

  /**
   * Unix epoch milliseconds recorded at the end of the most recent
   * {@linkcode Logger.updateAndGetTimestampDiff} call.
   * Used to compute the elapsed-time diff shown after each log line when
   * `options.timestamp` is enabled. `undefined` until the first message is logged.
   */
  private static lastTimestampAt?: number;

  /** Active context label for this instance, overridable via {@linkcode Logger.overrideLogger}. */
  private context?: string;
  /** Saved context label used to restore the original value after a temporary override. */
  private originalContext?: string;
  /** Resolved logger options (without `inspect` and `context` which are consumed at construction time). */
  private readonly options: Omit<LoggerOptions, "inspect" | "context">;
  /** `node:util` inspect options derived from {@linkcode LoggerOptions} at construction time. */
  private readonly inspectOptions: InspectOptions;

  /** Creates a logger with default options and no context label. */
  constructor();
  /**
   * Creates a logger bound to the given context label.
   *
   * @param {string} context - Label printed alongside every log line (e.g. `"AppModule"`).
   */
  constructor(context: string);
  /**
   * Creates a logger with the given options.
   *
   * @param {LoggerOptions} options - Configuration object; `options.context` is used as the label.
   */
  constructor(options: LoggerOptions);
  /**
   * Creates a logger bound to the given context label and with the given options.
   *
   * @param {string} context - Label printed alongside every log line.
   * @param {LoggerOptions} options - Additional configuration; `options.context` is ignored in favour of `context`.
   */
  constructor(context: string, options: LoggerOptions);
  constructor(
    contextOrOptions?: string | LoggerOptions,
    options?: LoggerOptions,
  ) {
    const [context, opts] = typeof contextOrOptions === "string"
      ? [contextOrOptions, options]
      : [contextOrOptions?.context, contextOrOptions];

    this.inspectOptions = opts?.inspect ?? {};

    delete opts?.inspect;
    delete opts?.context;

    this.context = context;
    this.options = opts ?? {};
    this.options.levels ??= ["log", "warn", "error", "fatal"];
    this.options.prefix ??= "Denorid";
    this.options.colors ??= true;

    this.inspectOptions.depth ??= DEFAULT_DEPTH;
    this.inspectOptions.compact = this.options.compact ??
      (this.options.json ?? false);
    this.inspectOptions.breakLength ??= this.options.colors
      ? this.options.compact ? Infinity : undefined
      : !this.options.compact
      ? undefined
      : Infinity;
  }

  /**
   * The shared {@linkcode LoggerService} instance used by all static methods.
   *
   * Lazily created on first access. Replace it via
   * {@linkcode Logger.overrideLogger} to redirect static log calls to a
   * custom logger implementation.
   */
  public static get staticInstanceRef(): LoggerService {
    return (this[STATIC_LOGGER_INSTANCE] ??= new Logger({ timestamp: true }));
  }

  /**
   * Returns `true` when `level` is present in the enabled `levels` list.
   *
   * All public log methods call this guard before doing any work, so messages
   * at disabled levels are dropped with zero formatting overhead.
   *
   * @param {LogLevel} level - The severity level to check.
   * @returns {boolean} `true` if the level is enabled, `false` otherwise.
   */
  protected isValidLevel(level: LogLevel): boolean {
    return this.options.levels!.includes(level);
  }

  /**
   * Logs a debug-level message. Only emitted when `"debug"` is in the enabled
   * `levels` list.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label that overrides the instance default.
   */
  public debug(message: unknown, context?: string): void;
  /**
   * Logs a debug-level message with additional values. Only emitted when
   * `"debug"` is in the enabled `levels` list. If the last argument is a
   * string it is treated as the context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public debug(
    message: unknown,
    ...optionalArgs: ArgsWithOptionalContext
  ): void;
  public debug(message: string, ...optionalArgs: unknown[]): void {
    if (this.isValidLevel("debug")) {
      const { messages, context } = this.getContextAndMessagesToPrint([
        message,
        ...optionalArgs,
      ]);

      this.printMessages(messages, context, "debug");
    }
  }

  /**
   * Logs a verbose-level message. Only emitted when `"verbose"` is in the
   * enabled `levels` list.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label that overrides the instance default.
   */
  public verbose(message: unknown, context?: string): void;
  /**
   * Logs a verbose-level message with additional values. Only emitted when
   * `"verbose"` is in the enabled `levels` list. If the last argument is a
   * string it is treated as the context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public verbose(
    message: unknown,
    ...optionalArgs: ArgsWithOptionalContext
  ): void;
  public verbose(message: string, ...optionalArgs: unknown[]): void {
    if (this.isValidLevel("verbose")) {
      const { messages, context } = this.getContextAndMessagesToPrint([
        message,
        ...optionalArgs,
      ]);

      this.printMessages(messages, context, "verbose");
    }
  }

  /**
   * Logs an informational message.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label that overrides the instance default.
   */
  public log(message: unknown, context?: string): void;
  /**
   * Logs an informational message with additional values. If the last argument
   * is a string it is treated as the context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public log(message: unknown, ...optionalArgs: ArgsWithOptionalContext): void;
  public log(message: string, ...optionalArgs: unknown[]): void {
    if (this.isValidLevel("log")) {
      const { messages, context } = this.getContextAndMessagesToPrint([
        message,
        ...optionalArgs,
      ]);

      this.printMessages(messages, context, "log");
    }
  }

  /**
   * Logs a warning message.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label that overrides the instance default.
   */
  public warn(message: unknown, context?: string): void;
  /**
   * Logs a warning message with additional values. If the last argument is a
   * string it is treated as the context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public warn(message: unknown, ...optionalArgs: ArgsWithOptionalContext): void;
  public warn(message: string, ...optionalArgs: unknown[]): void {
    if (this.isValidLevel("warn")) {
      const { messages, context } = this.getContextAndMessagesToPrint([
        message,
        ...optionalArgs,
      ]);

      this.printMessages(messages, context, "warn");
    }
  }

  /**
   * Logs a fatal (unrecoverable) message. Written to stderr.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label that overrides the instance default.
   */
  public fatal(message: unknown, context?: string): void;
  /**
   * Logs a fatal message with additional values. Written to stderr. If the
   * last argument is a string it is treated as the context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public fatal(
    message: unknown,
    ...optionalArgs: ArgsWithOptionalContext
  ): void;
  public fatal(message: string, ...optionalArgs: unknown[]): void {
    if (this.isValidLevel("fatal")) {
      const { messages, context } = this.getContextAndMessagesToPrint([
        message,
        ...optionalArgs,
      ]);

      this.printMessages(messages, context, "fatal");
    }
  }

  /**
   * Logs an error message. Written to stderr. If `contextOrStack` matches an
   * error stack trace pattern it is printed as a stack trace; otherwise it is
   * used as the context label.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} contextOrStack Optional stack trace string or context label.
   */
  public error(message: unknown, contextOrStack?: string): void;
  /**
   * Logs an error message with an explicit stack trace and context label.
   * Written to stderr.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} stack Error stack trace string.
   * @param {string|undefined} context Context label that overrides the instance default.
   */
  public error(message: unknown, stack?: string, context?: string): void;
  /**
   * Logs an error message with additional values. Written to stderr. If the
   * last argument is a string it is treated as the context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public error(
    message: unknown,
    ...optionalArgs: ArgsWithOptionalContext
  ): void;
  public error(message: string, ...optionalArgs: unknown[]): void {
    if (this.isValidLevel("error")) {
      const { messages, context, stack } = this
        .getContextAndStackAndMessagesToPrint([
          message,
          ...optionalArgs,
        ]);

      this.printMessages(messages, context, "error", stack);

      if (stack && !this.options.json) {
        this.writeFormattedMessage(
          `${stack}${this.options.forceConsole ? "" : "\n"}`,
          true,
        );
      }
    }
  }

  /**
   * Logs a debug-level message via the static singleton. Only emitted when
   * `"debug"` is in the singleton's enabled levels.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label.
   */
  public static debug(message: unknown, context?: string): void;
  /**
   * Logs a debug-level message with additional values via the static singleton.
   * If the last argument is a string it is treated as the context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public static debug(
    message: unknown,
    ...optionalArgs: ArgsWithOptionalContext
  ): void;
  public static debug(message: string, ...optionalArgs: unknown[]): void {
    this.staticInstanceRef.debug?.(message, ...optionalArgs);
  }

  /**
   * Logs a verbose-level message via the static singleton. Only emitted when
   * `"verbose"` is in the singleton's enabled levels.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label.
   */
  public static verbose(message: unknown, context?: string): void;
  /**
   * Logs a verbose-level message with additional values via the static singleton.
   * If the last argument is a string it is treated as the context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public static verbose(
    message: unknown,
    ...optionalArgs: ArgsWithOptionalContext
  ): void;
  public static verbose(message: string, ...optionalArgs: unknown[]): void {
    this.staticInstanceRef.verbose?.(message, ...optionalArgs);
  }

  /**
   * Logs an informational message via the static singleton.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label.
   */
  public static log(message: unknown, context?: string): void;
  /**
   * Logs an informational message with additional values via the static singleton.
   * If the last argument is a string it is treated as the context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public static log(
    message: unknown,
    ...optionalArgs: ArgsWithOptionalContext
  ): void;
  public static log(message: string, ...optionalArgs: unknown[]): void {
    this.staticInstanceRef.log(message, ...optionalArgs);
  }

  /**
   * Logs a warning message via the static singleton.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label.
   */
  public static warn(message: unknown, context?: string): void;
  /**
   * Logs a warning message with additional values via the static singleton.
   * If the last argument is a string it is treated as the context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public static warn(
    message: unknown,
    ...optionalArgs: ArgsWithOptionalContext
  ): void;
  public static warn(message: string, ...optionalArgs: unknown[]): void {
    this.staticInstanceRef.warn(message, ...optionalArgs);
  }

  /**
   * Logs a fatal (unrecoverable) message via the static singleton.
   * Written to stderr.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label.
   */
  public static fatal(message: unknown, context?: string): void;
  /**
   * Logs a fatal message with additional values via the static singleton.
   * Written to stderr. If the last argument is a string it is treated as the
   * context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public static fatal(
    message: unknown,
    ...optionalArgs: ArgsWithOptionalContext
  ): void;
  public static fatal(message: string, ...optionalArgs: unknown[]): void {
    this.staticInstanceRef.fatal(message, ...optionalArgs);
  }

  /**
   * Logs an error message via the static singleton. Written to stderr.
   *
   * @param {unknown} message The value to log.
   * @param {string|undefined} context Optional context label.
   */
  public static error(message: unknown, context?: string): void;
  /**
   * Logs an error message with additional values via the static singleton.
   * Written to stderr. If the last argument is a string it is treated as the
   * context label.
   *
   * @param {unknown} message The primary value to log.
   * @param {...ArgsWithOptionalContext} optionalArgs Additional values; last string element is used as context.
   */
  public static error(
    message: unknown,
    ...optionalArgs: ArgsWithOptionalContext
  ): void;
  public static error(message: string, ...optionalArgs: unknown[]): void {
    this.staticInstanceRef.error(message, ...optionalArgs);
  }

  /**
   * Restrict which levels the built-in static instance emits.
   * Messages at levels not in the array are silently dropped.
   *
   * @param {LogLevel[]} levels Array of {@linkcode LogLevel} values to enable.
   *
   * @example
   * ```ts
   * Logger.overrideLogger(["warn", "error", "fatal"]);
   * ```
   */
  public static overrideLogger(levels: LogLevel[]): void;
  /**
   * Temporarily override (`string`) or restore (`null`) the context label
   * used by the static logger instance.
   *
   * @param {string|null} context New context label, or `null` to revert to the original.
   *
   * @example
   * ```ts
   * Logger.overrideLogger("Bootstrap");
   * Logger.log("Starting…");
   * Logger.overrideLogger(null); // restore previous context
   * ```
   */
  public static overrideLogger(context: string | null): void;
  /**
   * Replace the static logger singleton with a custom
   * {@linkcode LoggerService} implementation.
   * All subsequent static `Logger.*` calls will be forwarded to it.
   *
   * @param {LoggerService} logger Custom logger instance.
   *
   * @example
   * ```ts
   * Logger.overrideLogger(new MyPinoLogger());
   * ```
   */
  public static overrideLogger(logger: LoggerService): void;
  public static overrideLogger(
    data: LogLevel[] | string | null | LoggerService,
  ): void {
    if (this.staticInstanceRef instanceof Logger) {
      if (Array.isArray(data)) {
        this.staticInstanceRef.options.levels = data;
      } else if (typeof data === "string" || data === null) {
        if (typeof data === "string") {
          this.staticInstanceRef.originalContext ??=
            this.staticInstanceRef.context;
          this.staticInstanceRef.context = data;
        } else if (this.staticInstanceRef.originalContext) {
          this.staticInstanceRef.context =
            this.staticInstanceRef.originalContext;

          delete this.staticInstanceRef.originalContext;
        }
      }
    } else if (
      typeof data === "object" && data !== null && !Array.isArray(data)
    ) {
      this[STATIC_LOGGER_INSTANCE] = data;
    }
  }

  /**
   * Writes a pre-formatted message to either stdout or stderr.
   *
   * When `forceConsole` is enabled in the logger options, output is delegated
   * to `console.log` / `console.error`. Otherwise the message is written
   * synchronously directly to the underlying Deno stream to preserve ordering.
   *
   * @param {string} formattedMessage - The fully-formatted log line to write.
   * @param {boolean} shouldUseStderr - When `true`, the message is written to stderr; otherwise stdout.
   */
  protected writeFormattedMessage(
    formattedMessage: string,
    shouldUseStderr: boolean,
  ): void {
    if (this.options.forceConsole) {
      if (shouldUseStderr) {
        console.error(formattedMessage.trim());
      } else {
        console.log(formattedMessage.trim());
      }
    } else {
      const stream = Deno[shouldUseStderr ? "stderr" : "stdout"];
      const data = new TextEncoder().encode(formattedMessage);
      let written = 0;

      while (written < data.length) {
        written += stream.writeSync(data.subarray(written));
      }
    }
  }

  /**
   * Formats and writes one or more log messages at the given level.
   *
   * Each message is rendered either as a structured JSON line (when
   * `options.json` is set) or as a human-readable string via
   * {@linkcode Logger.formatMessage}. The result is then handed off to
   * {@linkcode Logger.writeFormattedMessage}.
   *
   * @param {unknown[]} messages - The values to log. Each entry is formatted individually.
   * @param {string|undefined} context - Optional label printed alongside the log level (e.g. a class name).
   * @param {LogLevel} level - Severity level used for formatting and stream selection.
   * @param {unknown|undefined} errorStack - Optional stack trace appended after error messages.
   */
  protected printMessages(
    messages: unknown[],
    context: string | undefined,
    level: LogLevel,
    errorStack?: unknown,
  ): void {
    const shouldUseStderr = level === "error" || level === "fatal";
    const pidMessage = this.colorize(this.formatPid(), level);
    const contextMessage = this.formatContext(context);
    const formattedLogLevel = level.toUpperCase().padStart(7, " ");

    for (const message of messages) {
      if (this.options.json) {
        this.printAsJson(message, {
          context,
          level,
          shouldUseStderr,
          errorStack,
        });
      } else {
        const timestampDiff = this.updateAndGetTimestampDiff();
        const formattedMessage = this.formatMessage(
          message,
          level,
          pidMessage,
          formattedLogLevel,
          contextMessage,
          timestampDiff,
        );

        this.writeFormattedMessage(formattedMessage, shouldUseStderr);
      }
    }
  }

  /**
   * Serialises a single message as a structured JSON log line and writes it
   * to the appropriate stream.
   *
   * When colors are disabled and `inspectOptions.compact` is `true` the object
   * is serialised with `JSON.stringify` (using {@linkcode Logger.stringifyReplacer}
   * for non-serialisable values); otherwise `Deno.inspect` is used so the output
   * is pretty-printed.
   *
   * @param {unknown} message - The value to include as the `message` field.
   * @param {PrintMessageOptions} options - Contextual metadata (level, context, errorStack, …).
   */
  protected printAsJson(
    message: unknown,
    options: PrintMessageOptions,
  ): void {
    const logObject = this.getJsonLogObject(message, options);
    const formattedMessage =
      !this.options.colors && this.inspectOptions.compact === true
        ? `${JSON.stringify(logObject, this.stringifyReplacer)}\n`
        : `${inspect(logObject, this.inspectOptions)}\n`;

    this.writeFormattedMessage(
      formattedMessage,
      options.level === "error" || options.level === "fatal",
    );
  }

  /**
   * Replacer function passed to `JSON.stringify` during JSON log serialisation.
   *
   * Handles value types that are not natively serialisable by JSON:
   * - `bigint` and `symbol` are converted via `.toString()`.
   * - `Map`, `Set`, and `Error` instances are converted with `Deno.inspect`.
   *
   * @param {string} _ - The property key (unused).
   * @param {unknown} value - The value to serialise.
   *
   * @returns {string} A JSON-safe representation of `value`.
   */
  protected stringifyReplacer(_: string, value: unknown): unknown {
    if (typeof value === "bigint" || typeof value === "symbol") {
      return value.toString();
    }

    if (
      value instanceof Map || value instanceof Set || value instanceof Error
    ) {
      return inspect(value, this.inspectOptions);
    }

    return value;
  }

  /**
   * Builds the structured object that is serialised when JSON logging is active.
   *
   * The returned object always contains `level`, `pid`, `timestamp`, and
   * `message`. `context` and `stack` are included only when present in
   * `options`.
   *
   * @param {unknown} message - The log message value.
   * @param {PrintMessageOptions} options - Contextual metadata used to populate the log object fields.
   *
   * @returns {JsonLogObject} A fully-populated {@linkcode JsonLogObject}.
   */
  protected getJsonLogObject(
    message: unknown,
    options: PrintMessageOptions,
  ): JsonLogObject {
    const logObject: Partial<JsonLogObject> = {
      level: options.level,
      pid: Deno.pid,
      timestamp: Date.now(),
    };

    if (options.context) {
      logObject.context = options.context;
    }

    // add the message **after** the context for visual improvement
    logObject.message = message;

    if (options.errorStack) {
      logObject.stack = options.errorStack;
    }

    return logObject as JsonLogObject;
  }

  /**
   * Splits a variadic argument list into messages and an optional context label.
   *
   * When the last argument is a `string` it is treated as the context label and
   * removed from the messages array. If there is only a single argument, or the
   * last argument is not a string, the instance's current {@linkcode Logger.context}
   * is used instead.
   *
   * @param {unknown[]} args - Raw arguments passed to a log method.
   *
   * @returns {MessageContext} A {@linkcode MessageContext} with separated `messages` and `context`.
   */
  protected getContextAndMessagesToPrint(
    args: unknown[],
  ): MessageContext {
    if (args.length <= 1) {
      return { messages: args, context: this.context };
    }

    const lastElement = args.at(-1)!;

    if (typeof lastElement !== "string") {
      return { messages: args, context: this.context };
    }

    return {
      context: lastElement,
      messages: args.slice(0, args.length - 1),
    };
  }

  /**
   * Returns `true` when `stack` looks like a JavaScript stack trace string
   * (i.e. a multi-line string where the second line starts with `    at …:line:col`).
   *
   * @param {unknown} stack - The value to test.
   */
  private isStackFormat(stack: unknown) {
    return typeof stack === "string" &&
      /^(.)+\n\s+at .+:\d+:\d+/.test(stack);
  }

  /**
   * Extends {@linkcode Logger.getContextAndMessagesToPrint} with stack-trace
   * extraction for error-level log methods.
   *
   * When exactly two arguments are provided and the second looks like a stack
   * trace (tested via {@linkcode Logger.isStackFormat}), the second argument is
   * promoted to the `stack` field. Otherwise the logic falls back to the
   * standard context/messages split, additionally checking whether the
   * second-to-last element is a stack string.
   *
   * @param {unknown[]} args - Raw arguments passed to an error log method.
   *
   * @returns {StackMessageContext} A {@linkcode StackMessageContext} with separated `messages`, `context`, and optional `stack`.
   */
  protected getContextAndStackAndMessagesToPrint(
    args: unknown[],
  ): StackMessageContext {
    if (args.length === 2) {
      return this.isStackFormat(args[1])
        ? {
          messages: [args[0]],
          context: this.context,
          stack: args[1] as string,
        }
        : { ...this.getContextAndMessagesToPrint(args) };
    }

    const ctx = this.getContextAndMessagesToPrint(args);

    if (ctx.messages.length <= 1) {
      return ctx;
    }

    const lastElement = args.at(-1)!;

    if (typeof lastElement !== "string" && lastElement !== undefined) {
      return ctx;
    }

    return { ...ctx, stack: lastElement };
  }

  /**
   * Returns the formatted process-ID prefix string prepended to every log line.
   *
   * The format is `[<prefix>] <pid>  - `, e.g. `[Denorid] 12345  - `.
   *
   * @returns {string} The PID prefix string.
   */
  protected formatPid(): string {
    return `[${this.options.prefix}] ${Deno.pid}  - `;
  }

  /**
   * Formats an optional context label for display in a log line.
   *
   * When `context` is provided the label is wrapped in brackets and optionally
   * colourised with yellow (respecting the `colors` / `json` options via
   * {@linkcode Logger.colorIf}). When absent an empty string is returned so the
   * caller can always do a plain string concatenation.
   *
   * @param {string} context - The context label to format, or `undefined` for no label.
   *
   * @returns {string} A formatted context string such as `"[MyService] "`, or `""`.
   */
  protected formatContext(context: string | undefined): string {
    return !context ? "" : `[${this.colorIf(yellow, context)}] `;
  }

  /**
   * Converts a Unix-epoch millisecond timestamp into a human-readable date/time
   * string using the shared {@linkcode dateTimeFormatter} locale formatter.
   *
   * @param {number} timestamp - Unix epoch milliseconds (e.g. `Date.now()`).
   *
   * @returns {string} A locale-formatted date/time string, e.g. `"4/4/2026, 12:00:00 AM"`.
   */
  protected formatTimestamp(timestamp: number): string {
    return dateTimeFormatter.format(timestamp);
  }

  /**
   * Formats the time elapsed since the previous log call as a colourised suffix.
   *
   * The returned string has the form `" +<diffInMs>ms"` and is colourised yellow
   * when colours are enabled (via {@linkcode Logger.colorIf}). An empty string
   * is returned by {@linkcode Logger.updateAndGetTimestampDiff} when there is no
   * previous timestamp to diff against.
   *
   * @param {number} diffInMs - Elapsed milliseconds since the last log call.
   *
   * @returns {string} A formatted diff string such as `" +42ms"`.
   */
  protected formatTimestampDiff(diffInMs: number): string {
    const text = ` +${diffInMs}ms`;

    return this.colorIf(yellow, text);
  }

  /**
   * Applies a colour function to `text` only when colours are enabled and
   * JSON mode is off.
   *
   * This is a convenience wrapper used by formatting helpers so they do not
   * need to repeat the `options.colors && !options.json` guard themselves.
   *
   * @param {(s: string) => string} color - A `@std/fmt/colors` colour function (e.g. `yellow`, `bold`).
   * @param {string} text - The string to optionally colourise.
   *
   * @returns `color(text)` when colours are active, otherwise `text` unchanged.
   */
  protected colorIf(color: (s: string) => string, text: string): string {
    return this.options.colors && !this.options.json ? color(text) : text;
  }

  /**
   * Applies the log-level colour to a message string.
   *
   * When colours are disabled or JSON mode is active the message is returned
   * unchanged. Otherwise the colour function returned by
   * {@linkcode Logger.getColorByLogLevel} is applied.
   *
   * @param {unknown} message - The string to colourise.
   * @param {LogLevel} level - The severity level whose colour to apply.
   *
   * @returns {string} The colourised string, or `message` when colours are inactive.
   */
  protected colorize(message: string, level: LogLevel): string {
    if (!this.options.colors || this.options.json) {
      return message;
    }

    return this.getColorByLogLevel(level)(message);
  }

  /**
   * Returns the ANSI colour function associated with a given log level.
   *
   * | Level     | Colour          |
   * |-----------|-----------------|
   * | `debug`   | bright magenta  |
   * | `verbose` | bright cyan     |
   * | `warn`    | yellow          |
   * | `fatal`   | red             |
   * | `error`   | bold red        |
   * | default   | green           |
   *
   * @param {LogLevel} level - The severity level to look up.
   *
   * @returns {(s: string) => string} A `@std/fmt/colors` colour function.
   */
  protected getColorByLogLevel(level: LogLevel): (s: string) => string {
    switch (level) {
      case "debug":
        return brightMagenta;
      case "verbose":
        return brightCyan;
      case "warn":
        return yellow;
      case "fatal":
        return red;
      case "error":
        return boldRed;
      default:
        return green;
    }
  }

  /**
   * Assembles the full human-readable log line for a single message.
   *
   * The line follows the pattern:
   * ```
   * <pidMessage><timestamp> <level> <contextMessage><output><timestampDiff>\n
   * ```
   * Each segment is already pre-formatted and optionally colourised by the
   * caller; this method only concatenates them.
   *
   * @param {unknown} message - The raw value to log; serialised via {@linkcode Logger.stringifyMessage}.
   * @param {LogLevel} level - Severity level, used to colourise the log-level segment.
   * @param {string} pidMessage - Pre-formatted PID prefix from {@linkcode Logger.formatPid}.
   * @param {string} formattedLogLevel - Right-padded, upper-cased level string (e.g. `"    LOG"`).
   * @param {string} contextMessage - Pre-formatted context label from {@linkcode Logger.formatContext}.
   * @param {string} timestampDiff - Pre-formatted elapsed-time suffix from {@linkcode Logger.updateAndGetTimestampDiff}.
   * @returns {string} The complete log line including a trailing newline.
   */
  protected formatMessage(
    message: unknown,
    level: LogLevel,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    const output = this.stringifyMessage(message, level);

    return `${pidMessage}${this.formatTimestamp(Date.now())} ${
      this.colorize(formattedLogLevel, level)
    } ${contextMessage}${output}${timestampDiff}\n`;
  }

  /**
   * Converts any log message value to its printable string representation.
   *
   * Handles the following cases in order:
   * - **Class reference** (`class Foo {}`): returns the class name via recursion.
   * - **Plain function**: calls the function (no arguments) and recurses on the return value.
   * - **String**: colourises with the level colour via {@linkcode Logger.colorize}.
   * - **Plain object** (`{}`): inspects and prefixes with `Object(<keyCount>)`.
   * - **Array**: inspects and prefixes with `Array(<length>)`.
   * - **Anything else** (numbers, errors, Maps, …): formatted with `node:util` `inspect`.
   *
   * @param {unknown} message - The value to stringify.
   * @param {LogLevel} level - Severity level passed through to colourisation helpers.
   * @returns A printable, optionally colourised string.
   */
  protected stringifyMessage(
    message: unknown,
    level: LogLevel,
  ): string {
    if (typeof message === "function") {
      const messageAsStr = message.toString();
      const isClass = messageAsStr.startsWith("class ");

      if (isClass) {
        return this.stringifyMessage(message.name, level);
      }

      return this.stringifyMessage(message(), level);
    }

    if (typeof message === "string") {
      return this.colorize(message, level);
    }

    const text = inspect(message, this.inspectOptions);

    if (isPlainObject(message)) {
      return `Object(${Object.keys(text).length}) ${text}`;
    }
    if (Array.isArray(message)) {
      return `Array(${message.length}) ${text}`;
    }

    return text;
  }

  /**
   * Computes the elapsed-time diff suffix and advances the internal timestamp.
   *
   * On every call `Logger.lastTimestampAt` is updated to `Date.now()`. When
   * both a previous timestamp exists **and** `options.timestamp` is enabled, the
   * diff since the last call is formatted via {@linkcode Logger.formatTimestampDiff}
   * and returned. Otherwise an empty string is returned (no diff shown for the
   * very first message, or when the `timestamp` option is off).
   *
   * @returns {string} A formatted diff string (e.g. `" +12ms"`) or `""`.
   */
  protected updateAndGetTimestampDiff(): string {
    const includeTimestamp = Logger.lastTimestampAt && this.options.timestamp;
    const result = includeTimestamp
      ? this.formatTimestampDiff(Date.now() - Logger.lastTimestampAt!)
      : "";
    Logger.lastTimestampAt = Date.now();
    return result;
  }
}
