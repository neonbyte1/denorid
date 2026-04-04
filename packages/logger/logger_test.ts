import { assertEquals, assertMatch } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { spy } from "@std/testing/mock";
import { Logger } from "./logger.ts";
import type { LoggerService } from "./logger_service.ts";

describe("Logger", () => {
  let originalStdoutWriteSync: typeof Deno.stdout.writeSync;
  let originalStderrWriteSync: typeof Deno.stderr.writeSync;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let capturedOutput: string;
  let capturedStderr: string;

  beforeEach(() => {
    capturedOutput = "";
    capturedStderr = "";
    originalStdoutWriteSync = Deno.stdout.writeSync;
    originalStderrWriteSync = Deno.stderr.writeSync;
    originalConsoleLog = console.log;
    originalConsoleError = console.error;

    Deno.stdout.writeSync = spy((data: Uint8Array): number => {
      capturedOutput += new TextDecoder().decode(data);
      return data.length;
    });

    Deno.stderr.writeSync = spy((data: Uint8Array): number => {
      capturedStderr += new TextDecoder().decode(data);
      return data.length;
    });

    console.log = spy((...args: unknown[]): void => {
      capturedOutput += args.map((arg) => JSON.stringify(arg)).join(" ");
    });

    console.error = spy((...args: unknown[]): void => {
      capturedStderr += args.map((arg) => JSON.stringify(arg)).join(" ");
    });
  });

  afterEach(() => {
    Deno.stdout.writeSync = originalStdoutWriteSync;
    Deno.stderr.writeSync = originalStderrWriteSync;

    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe("constructor", () => {
    it("should create the instance using the constructor with context signature", () => {
      const logger = new Logger("TestContext");

      assertEquals({
        context: logger["context"],
        options: logger["options"],
      }, {
        context: "TestContext",
        options: {
          colors: true,
          levels: ["log", "warn", "error", "fatal"],
          prefix: "Denorid",
        },
      });
    });

    it("should create the instance using the constructor with options signature", () => {
      const logger = new Logger({
        context: "TestContext",
        colors: false,
        levels: ["debug"],
      });

      assertEquals({
        context: logger["context"],
        options: logger["options"],
      }, {
        context: "TestContext",
        options: {
          colors: false,
          levels: ["debug"],
          prefix: "Denorid",
        },
      });
    });

    it("should create instance with context and options", () => {
      const logger = new Logger("MyContext", { colors: false, prefix: "Test" });

      assertEquals(logger["context"], "MyContext");
      assertEquals(logger["options"].colors, false);
      assertEquals(logger["options"].prefix, "Test");
    });

    it("should create instance with no arguments", () => {
      const logger = new Logger();

      assertEquals(logger["context"], undefined);
      assertEquals(logger["options"].prefix, "Denorid");
    });

    it("should not modify breakLength if already set", () => {
      const logger = new Logger({ inspect: { breakLength: 123 } });

      assertEquals(logger["inspectOptions"].breakLength, 123);
    });

    it("should set breakLength to Infinity when colors=true and compact=true", () => {
      const logger = new Logger({ colors: true, compact: true });

      assertEquals(logger["inspectOptions"].breakLength, Infinity);
    });

    it("should not modify breakLength if colors=true and compact=false", () => {
      const logger = new Logger({ colors: true, compact: false });

      assertEquals(logger["inspectOptions"].breakLength, undefined);
    });

    it("should set breakLength to Infinity when colors=false and compact=true", () => {
      const logger = new Logger({ colors: false, compact: true });

      assertEquals(logger["inspectOptions"].breakLength, Infinity);
    });

    it("should set compact to true when json=true", () => {
      const logger = new Logger({ json: true });

      assertEquals(logger["inspectOptions"].compact, true);
    });

    it("should use default depth when not specified", () => {
      const logger = new Logger();

      assertEquals(logger["inspectOptions"].depth, 5);
    });

    it("should use custom depth from inspect options", () => {
      const logger = new Logger({ inspect: { depth: 10 } });

      assertEquals(logger["inspectOptions"].depth, 10);
    });
  });

  describe("formatPid", () => {
    it("should append the prefix to formatPid", () => {
      const logger = new Logger();

      assertEquals(logger["formatPid"](), `[Denorid] ${Deno.pid}  - `);
    });

    it("should use custom prefix", () => {
      const logger = new Logger({ prefix: "MyApp" });

      assertEquals(logger["formatPid"](), `[MyApp] ${Deno.pid}  - `);
    });
  });

  describe("formatContext", () => {
    it("should return empty string when argument is an empty string", () => {
      const logger = new Logger();

      assertEquals(logger["formatContext"](""), "");
    });

    it("should return empty string when argument is undefined", () => {
      const logger = new Logger();

      assertEquals(logger["formatContext"](undefined), "");
    });

    it("should return a formatted version of the input argument", () => {
      const logger = new Logger({ colors: false });

      assertEquals(logger["formatContext"]("App"), "[App] ");
    });

    it("should colorize context when colors enabled", () => {
      const logger = new Logger({ colors: true });
      const result = logger["formatContext"]("App");

      assertMatch(result, /\[.*App.*\]/);
    });
  });

  describe("formatTimestamp", () => {
    it("should format a timestamp", () => {
      const logger = new Logger();
      const result = logger["formatTimestamp"](Date.now());

      assertMatch(result, /\d+/);
    });
  });

  describe("formatTimestampDiff", () => {
    it("should format timestamp diff with ms", () => {
      const logger = new Logger({ colors: false });
      const result = logger["formatTimestampDiff"](100);

      assertEquals(result, " +100ms");
    });

    it("should colorize when colors enabled", () => {
      const logger = new Logger({ colors: true });
      const result = logger["formatTimestampDiff"](50);

      assertMatch(result, /\+50ms/);
    });
  });

  describe("colorIf", () => {
    it("should apply color when colors enabled and not json", () => {
      const logger = new Logger({ colors: true, json: false });
      const colorFn = (s: string) => `[colored]${s}[/colored]`;
      const result = logger["colorIf"](colorFn, "test");

      assertEquals(result, "[colored]test[/colored]");
    });

    it("should not apply color when colors disabled", () => {
      const logger = new Logger({ colors: false });
      const colorFn = (s: string) => `[colored]${s}[/colored]`;
      const result = logger["colorIf"](colorFn, "test");

      assertEquals(result, "test");
    });

    it("should not apply color when json mode", () => {
      const logger = new Logger({ colors: true, json: true });
      const colorFn = (s: string) => `[colored]${s}[/colored]`;
      const result = logger["colorIf"](colorFn, "test");

      assertEquals(result, "test");
    });
  });

  describe("colorize", () => {
    it("should colorize message when colors enabled", () => {
      const logger = new Logger({ colors: true });
      const result = logger["colorize"]("test", "log");

      assertMatch(result, /test/);
    });

    it("should not colorize when colors disabled", () => {
      const logger = new Logger({ colors: false });
      const result = logger["colorize"]("test", "log");

      assertEquals(result, "test");
    });

    it("should not colorize when json mode", () => {
      const logger = new Logger({ colors: true, json: true });
      const result = logger["colorize"]("test", "log");

      assertEquals(result, "test");
    });
  });

  describe("getColorByLogLevel", () => {
    it("should return color for debug level", () => {
      const logger = new Logger({ colors: true });
      const color = logger["getColorByLogLevel"]("debug");
      assertEquals(typeof color, "function");
    });

    it("should return color for verbose level", () => {
      const logger = new Logger({ colors: true });
      const color = logger["getColorByLogLevel"]("verbose");
      assertEquals(typeof color, "function");
    });

    it("should return color for warn level", () => {
      const logger = new Logger({ colors: true });
      const color = logger["getColorByLogLevel"]("warn");
      assertEquals(typeof color, "function");
    });

    it("should return color for fatal level", () => {
      const logger = new Logger({ colors: true });
      const color = logger["getColorByLogLevel"]("fatal");
      assertEquals(typeof color, "function");
    });

    it("should return color for error level", () => {
      const logger = new Logger({ colors: true });
      const color = logger["getColorByLogLevel"]("error");
      assertEquals(typeof color, "function");
    });

    it("should return default color for log level", () => {
      const logger = new Logger({ colors: true });
      const color = logger["getColorByLogLevel"]("log");
      assertEquals(typeof color, "function");
    });
  });

  describe("getContextAndMessagesToPrint", () => {
    it("should return context from instance when single message", () => {
      const logger = new Logger("InstanceContext");
      const result = logger["getContextAndMessagesToPrint"](["message"]);

      assertEquals(result, {
        messages: ["message"],
        context: "InstanceContext",
      });
    });

    it("should return empty array messages and instance context for empty args", () => {
      const logger = new Logger("InstanceContext");
      const result = logger["getContextAndMessagesToPrint"]([]);

      assertEquals(result, { messages: [], context: "InstanceContext" });
    });

    it("should use last string as context when multiple args", () => {
      const logger = new Logger();
      const result = logger["getContextAndMessagesToPrint"]([
        "msg1",
        "msg2",
        "CustomContext",
      ]);

      assertEquals(result, {
        messages: ["msg1", "msg2"],
        context: "CustomContext",
      });
    });

    it("should keep all messages if last element is not string", () => {
      const logger = new Logger("Default");
      const result = logger["getContextAndMessagesToPrint"](["msg1", {
        obj: true,
      }]);

      assertEquals(result, {
        messages: ["msg1", { obj: true }],
        context: "Default",
      });
    });
  });

  describe("isStackFormat", () => {
    it("should return true for valid stack format", () => {
      const logger = new Logger();
      const stack = "Error: test\n    at someFunction:10:5";
      const result = logger["isStackFormat"](stack);

      assertEquals(result, true);
    });

    it("should return false for non-stack string", () => {
      const logger = new Logger();
      const result = logger["isStackFormat"]("just a string");

      assertEquals(result, false);
    });

    it("should return false for non-string", () => {
      const logger = new Logger();
      const result = logger["isStackFormat"](123);

      assertEquals(result, false);
    });
  });

  describe("getContextAndStackAndMessagesToPrint", () => {
    it("should handle two args with stack format", () => {
      const logger = new Logger("Ctx");
      const stack = "Error: test\n    at fn:10:5";
      const result = logger["getContextAndStackAndMessagesToPrint"]([
        "msg",
        stack,
      ]);

      assertEquals(result, { messages: ["msg"], context: "Ctx", stack });
    });

    it("should handle two args without stack format", () => {
      const logger = new Logger();
      const result = logger["getContextAndStackAndMessagesToPrint"]([
        "msg",
        "CustomContext",
      ]);

      assertEquals(result, { messages: ["msg"], context: "CustomContext" });
    });

    it("should handle single message", () => {
      const logger = new Logger("Ctx");
      const result = logger["getContextAndStackAndMessagesToPrint"](["msg"]);

      assertEquals(result, { messages: ["msg"], context: "Ctx" });
    });

    it("should handle multiple messages with string stack at end", () => {
      const logger = new Logger();
      const result = logger["getContextAndStackAndMessagesToPrint"]([
        "msg1",
        "msg2",
        "stackOrCtx",
      ]);

      assertEquals(result.messages, ["msg1", "msg2"]);
      assertEquals(result.context, "stackOrCtx");
    });

    it("should handle multiple messages with undefined at end", () => {
      const logger = new Logger("Ctx");
      const result = logger["getContextAndStackAndMessagesToPrint"]([
        "msg1",
        "msg2",
        undefined,
      ]);

      assertEquals(result.stack, undefined);
    });

    it("should not extract stack when last element is object", () => {
      const logger = new Logger("Ctx");
      const result = logger["getContextAndStackAndMessagesToPrint"]([
        "msg1",
        "msg2",
        { obj: true },
      ]);

      assertEquals(result.messages, ["msg1", "msg2", { obj: true }]);
      assertEquals(result.stack, undefined);
    });
  });

  describe("stringifyMessage", () => {
    it("should stringify string message", () => {
      const logger = new Logger({ colors: false });
      const result = logger["stringifyMessage"]("hello", "log");

      assertEquals(result, "hello");
    });

    it("should stringify function that returns value", () => {
      const logger = new Logger({ colors: false });
      const result = logger["stringifyMessage"](() => "from fn", "log");

      assertEquals(result, "from fn");
    });

    it("should stringify class by name", () => {
      const logger = new Logger({ colors: false });
      class TestClass {}
      const result = logger["stringifyMessage"](TestClass, "log");

      assertEquals(result, "TestClass");
    });

    it("should stringify object using inspect", () => {
      const logger = new Logger({ colors: false });
      const result = logger["stringifyMessage"]({ key: "value" }, "log");

      assertMatch(result, /key/);
    });

    it("should stringify array", () => {
      const logger = new Logger({ colors: false, compact: true });
      const result = logger["stringifyMessage"]([1, 2, 3], "log");

      assertMatch(result, /1.*2.*3/);
    });

    it("should stringify number", () => {
      const logger = new Logger({ colors: false });
      const result = logger["stringifyMessage"](42, "log");

      assertMatch(result, /42/);
    });
  });

  describe("updateAndGetTimestampDiff", () => {
    it("should return empty string on first call when timestamp disabled", () => {
      const logger = new Logger({ timestamp: false });
      const result = logger["updateAndGetTimestampDiff"]();

      assertEquals(result, "");
    });

    it("should return diff on subsequent calls when timestamp enabled", () => {
      const logger = new Logger({ timestamp: true, colors: false });
      logger["updateAndGetTimestampDiff"]();
      const result = logger["updateAndGetTimestampDiff"]();

      assertMatch(result, /\+\d+ms/);
    });
  });

  describe("formatMessage", () => {
    it("should format a complete message", () => {
      const logger = new Logger({ colors: false });
      const result = logger["formatMessage"](
        "test message",
        "log",
        "[Denorid] 123  - ",
        "    LOG",
        "[Ctx] ",
        " +10ms",
      );

      assertMatch(result, /test message/);
      assertMatch(result, /LOG/);
    });
  });

  describe("log", () => {
    it("should do nothing when the associated level is not set", () => {
      new Logger({ levels: [] }).fatal("some message");

      assertEquals(capturedOutput, "");
    });

    it("should log a message to stdout", () => {
      const logger = new Logger({ colors: false });
      logger.log("test message");

      assertMatch(capturedOutput, /test message/);
    });

    it("should log with context", () => {
      const logger = new Logger("MyContext", { colors: false });
      logger.log("hello");

      assertMatch(capturedOutput, /LOG/);
      assertMatch(capturedOutput, /MyContext/);
      assertMatch(capturedOutput, /hello/);
    });

    it("yy", () => {
      const logger = new Logger({ levels: [] });

      logger.debug(Date.now());
      logger.verbose(Date.now());
      logger.log(Date.now());
      logger.warn(Date.now());
      logger.fatal(Date.now());
      logger.error(Date.now());

      assertEquals(capturedOutput, "");
    });

    it("xx", () => {
      const logger = new Logger({
        levels: ["debug", "verbose", "log", "warn", "fatal", "error"],
        json: false,
      });

      logger.debug(Date.now());
      assertMatch(capturedOutput, /DEBUG/);

      capturedOutput = "";
      logger.verbose(Date.now());
      assertMatch(capturedOutput, /VERBOSE/);

      capturedOutput = "";
      logger.log(Date.now());
      assertMatch(capturedOutput, /LOG/);

      capturedOutput = "";
      logger.warn(Date.now());
      assertMatch(capturedOutput, /WARN/);

      logger.fatal(Date.now());
      assertMatch(capturedStderr, /FATAL/);

      capturedStderr = "";
      logger.error(
        Date.now(),
        "asdasd",
        `
This could be
some stack message
`,
      );
      assertMatch(capturedStderr, /ERROR/);
    });

    it("askljalsdj", () => {
      const logger = new Logger({ forceConsole: true });
      logger.error(
        Date.now(),
        "asdasd",
        `
This could be
some stack message
`,
      );
      assertMatch(capturedStderr, /some stack message/);
    });
  });

  describe("printMessages", () => {
    it("should print to stderr for error level", () => {
      const logger = new Logger({ colors: false });
      logger["printMessages"](["error msg"], "ErrorCtx", "error");

      assertMatch(capturedStderr, /error msg/);
    });

    it("should print to stderr for fatal level", () => {
      const logger = new Logger({ colors: false });
      logger["printMessages"](["fatal msg"], "FatalCtx", "fatal");

      assertMatch(capturedStderr, /fatal msg/);
    });

    it("should print multiple messages", () => {
      const logger = new Logger({ colors: false });
      logger["printMessages"](["msg1", "msg2"], "Ctx", "log");

      assertMatch(capturedOutput, /msg1/);
      assertMatch(capturedOutput, /msg2/);
    });
  });

  describe("writeFormattedMessage with forceConsole", () => {
    it("should use console.log when forceConsole=true and not stderr", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      const logger = new Logger({ forceConsole: true, colors: false });
      logger["writeFormattedMessage"]("test message\n", false);

      console.log = originalLog;
      assertEquals(logs.length, 1);
      assertMatch(logs[0], /test message/);
    });

    it("should use console.error when forceConsole=true and stderr", () => {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.join(" "));

      const logger = new Logger({ forceConsole: true, colors: false });
      logger["writeFormattedMessage"]("error message\n", true);

      console.error = originalError;
      assertEquals(errors.length, 1);
      assertMatch(errors[0], /error message/);
    });
  });

  describe("JSON mode", () => {
    it("should print as JSON when json=true", () => {
      const logger = new Logger({ json: true, colors: false, compact: true });
      logger.log("json test");

      assertMatch(capturedOutput, /level/);
      assertMatch(capturedOutput, /message/);
      assertMatch(capturedOutput, /pid/);
    });

    it("should include context in JSON output", () => {
      const logger = new Logger("JsonCtx", {
        json: true,
        colors: false,
        compact: true,
      });
      logger.log("with context");

      assertMatch(capturedOutput, /JsonCtx/);
    });

    it("should use inspect for JSON with colors", () => {
      const logger = new Logger({ json: true, colors: true });
      logger.log("colored json");

      assertMatch(capturedOutput, /message/);
    });
  });

  describe("printAsJson", () => {
    it("should print JSON log object", () => {
      const logger = new Logger({ json: true, colors: false, compact: true });
      logger["printAsJson"]("test", {
        context: "Ctx",
        level: "log",
        shouldUseStderr: false,
      });

      assertMatch(capturedOutput, /test/);
    });

    it("should include error stack in JSON", () => {
      const logger = new Logger({ json: true, colors: false, compact: true });
      logger["printAsJson"]("error", {
        context: "Ctx",
        level: "error",
        shouldUseStderr: true,
        errorStack: "Error: test\n    at fn:1:1",
      });

      assertMatch(capturedStderr, /stack/);
    });
  });

  describe("getJsonLogObject", () => {
    it("should create JSON log object without context", () => {
      const logger = new Logger({ json: true });
      const result = logger["getJsonLogObject"]("msg", {
        level: "log",
        shouldUseStderr: false,
      });

      assertEquals(result.level, "log");
      assertEquals(result.message, "msg");
      assertEquals(result.context, undefined);
    });

    it("should create JSON log object with context", () => {
      const logger = new Logger({ json: true });
      const result = logger["getJsonLogObject"]("msg", {
        context: "Ctx",
        level: "warn",
        shouldUseStderr: false,
      });

      assertEquals(result.context, "Ctx");
    });

    it("should include stack in JSON log object", () => {
      const logger = new Logger({ json: true });
      const result = logger["getJsonLogObject"]("msg", {
        level: "error",
        shouldUseStderr: true,
        errorStack: "stack trace",
      });

      assertEquals(result.stack, "stack trace");
    });
  });

  describe("stringifyReplacer", () => {
    it("should convert bigint to string", () => {
      const logger = new Logger();
      const result = logger["stringifyReplacer"]("key", BigInt(123));

      assertEquals(result, "123");
    });

    it("should convert symbol to string", () => {
      const logger = new Logger();
      const result = logger["stringifyReplacer"]("key", Symbol("test"));

      assertEquals(result, "Symbol(test)");
    });

    it("should inspect Map", () => {
      const logger = new Logger();
      const map = new Map([["a", 1]]);
      const result = logger["stringifyReplacer"]("key", map);

      assertMatch(String(result), /Map/);
    });

    it("should inspect Set", () => {
      const logger = new Logger();
      const set = new Set([1, 2, 3]);
      const result = logger["stringifyReplacer"]("key", set);

      assertMatch(String(result), /Set/);
    });

    it("should inspect Error", () => {
      const logger = new Logger();
      const error = new Error("test error");
      const result = logger["stringifyReplacer"]("key", error);

      assertMatch(String(result), /Error/);
    });

    it("should return other values unchanged", () => {
      const logger = new Logger();

      assertEquals(logger["stringifyReplacer"]("key", "string"), "string");
      assertEquals(logger["stringifyReplacer"]("key", 123), 123);
      assertEquals(logger["stringifyReplacer"]("key", true), true);
      assertEquals(logger["stringifyReplacer"]("key", null), null);
    });
  });

  describe("static methods", () => {
    const STATIC_KEY = Symbol.for("drizzle.static_logger");

    beforeEach(() => {
      (Logger as unknown as Record<symbol, unknown>)[STATIC_KEY] = undefined;
    });

    afterEach(() => {
      (Logger as unknown as Record<symbol, unknown>)[STATIC_KEY] = undefined;
    });

    it("should delegate Logger.debug to staticInstanceRef", () => {
      Logger.overrideLogger(["debug"]);
      Logger.debug("debug msg");

      assertMatch(capturedOutput, /debug msg/);
    });

    it("should delegate Logger.verbose to staticInstanceRef", () => {
      Logger.overrideLogger(["verbose"]);
      Logger.verbose("verbose msg");

      assertMatch(capturedOutput, /verbose msg/);
    });

    it("should delegate Logger.log to staticInstanceRef", () => {
      Logger.log("log msg");

      assertMatch(capturedOutput, /log msg/);
    });

    it("should delegate Logger.warn to staticInstanceRef", () => {
      Logger.warn("warn msg");

      assertMatch(capturedOutput, /warn msg/);
    });

    it("should delegate Logger.fatal to staticInstanceRef", () => {
      Logger.fatal("fatal msg");

      assertMatch(capturedStderr, /fatal msg/);
    });

    it("should delegate Logger.error to staticInstanceRef", () => {
      Logger.error("error msg");

      assertMatch(capturedStderr, /error msg/);
    });
  });

  describe("overrideLogger", () => {
    const STATIC_KEY = Symbol.for("drizzle.static_logger");

    beforeEach(() => {
      (Logger as unknown as Record<symbol, unknown>)[STATIC_KEY] = undefined;
    });

    afterEach(() => {
      (Logger as unknown as Record<symbol, unknown>)[STATIC_KEY] = undefined;
    });

    it("should set levels on the static Logger instance when called with an array", () => {
      Logger.overrideLogger(["debug", "verbose"]);
      const ref = Logger.staticInstanceRef as unknown as Record<
        string,
        Record<string, unknown>
      >;

      assertEquals(ref["options"]["levels"], ["debug", "verbose"]);
    });

    it("should set context and save originalContext when called with a string", () => {
      const ref = Logger.staticInstanceRef as unknown as Record<
        string,
        unknown
      >;
      (ref as Record<string, unknown>)["context"] = "OriginalCtx";

      Logger.overrideLogger("NewContext");

      assertEquals(ref["context"], "NewContext");
      assertEquals(ref["originalContext"], "OriginalCtx");
    });

    it("should restore original context and clear originalContext when called with null", () => {
      const ref = Logger.staticInstanceRef as unknown as Record<
        string,
        unknown
      >;
      ref["context"] = "OriginalCtx";

      Logger.overrideLogger("TempCtx");
      Logger.overrideLogger(null);

      assertEquals(ref["context"], "OriginalCtx");
      assertEquals(ref["originalContext"], undefined);
    });

    it("should replace staticInstanceRef with a custom LoggerService when not instanceof Logger", () => {
      const placeholder: LoggerService = {
        log: spy((_msg: unknown, ..._args: unknown[]): void => {}),
        warn: () => {},
        fatal: () => {},
        error: () => {},
      };
      (Logger as unknown as Record<symbol, unknown>)[STATIC_KEY] = placeholder;

      const replacement: LoggerService = {
        log: spy((_msg: unknown, ..._args: unknown[]): void => {}),
        warn: () => {},
        fatal: () => {},
        error: () => {},
      };
      Logger.overrideLogger(replacement);

      assertEquals(Logger.staticInstanceRef, replacement);
    });
  });

  describe("edge cases", () => {
    it("should handle nested function returning function", () => {
      const logger = new Logger({ colors: false });
      const result = logger["stringifyMessage"](() => () => "nested", "log");

      assertMatch(result, /nested|function/i);
    });

    it("should handle colorize for all log levels", () => {
      const logger = new Logger({ colors: true });

      logger["colorize"]("msg", "debug");
      logger["colorize"]("msg", "verbose");
      logger["colorize"]("msg", "log");
      logger["colorize"]("msg", "warn");
      logger["colorize"]("msg", "error");
      logger["colorize"]("msg", "fatal");
    });

    it("should handle printing to stderr for fatal level via printMessages", () => {
      const logger = new Logger({ json: true, colors: false, compact: true });
      logger["printMessages"](["fatal error"], "Ctx", "fatal", "Error stack");

      assertMatch(capturedStderr, /fatal error/);
    });
  });
});
