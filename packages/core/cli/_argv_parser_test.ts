import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  CommandParseError,
  parseCommandArgs,
  preScanArgv,
} from "./_argv_parser.ts";
import type { InputOption } from "./options.ts";

describe("preScanArgv()", () => {
  it("returns no command and no flags for an empty argv", () => {
    assertEquals(preScanArgv([]), {
      commandName: undefined,
      rest: [],
      noColor: false,
      help: false,
    });
  });

  it("identifies the first non-option token as the command name", () => {
    assertEquals(
      preScanArgv(["cache:clear", "--scope", "all"]),
      {
        commandName: "cache:clear",
        rest: ["--scope", "all"],
        noColor: false,
        help: false,
      },
    );
  });

  it("recognises --no-color anywhere on the line", () => {
    assertEquals(
      preScanArgv(["--no-color", "cache:clear"]).noColor,
      true,
    );
    assertEquals(
      preScanArgv(["cache:clear", "--no-color"]).noColor,
      true,
    );
  });

  it("recognises --help and -h", () => {
    assertEquals(preScanArgv(["--help"]).help, true);
    assertEquals(preScanArgv(["-h"]).help, true);
    assertEquals(preScanArgv(["cmd", "-h"]).help, true);
  });

  it("preserves -- and everything after it in rest verbatim", () => {
    const result = preScanArgv(["cmd", "--", "--no-color", "-h"]);

    assertEquals(result.commandName, "cmd");
    assertEquals(result.rest, ["--", "--no-color", "-h"]);
    assertEquals(result.noColor, false);
    assertEquals(result.help, false);
  });
  it("picks the first non-flag token as the command, even when unknown flags precede it", () => {
    const result = preScanArgv(["--unknown", "value"]);

    assertEquals(result.commandName, "value");
    assertEquals(result.rest, ["--unknown"]);
  });

  it("returns no command when every token is a flag", () => {
    assertEquals(preScanArgv(["--unknown"]).commandName, undefined);
    assertEquals(preScanArgv(["--unknown"]).rest, ["--unknown"]);
  });
});

describe("parseCommandArgs()", () => {
  const stringOpt: InputOption = { name: "scope", type: "string" };
  const boolOpt: InputOption = {
    name: "force",
    shortcut: "f",
    type: "boolean",
  };
  const numOpt: InputOption = { name: "count", type: "number" };
  const arrOpt: InputOption = { name: "tag", array: true, type: "string" };

  describe("long options", () => {
    it("parses --name value form", () => {
      const result = parseCommandArgs(["--scope", "all"], [stringOpt]);

      assertEquals(result.options.scope, "all");
    });

    it("parses --name=value form", () => {
      const result = parseCommandArgs(["--scope=all"], [stringOpt]);

      assertEquals(result.options.scope, "all");
    });

    it("treats --flag as a boolean true", () => {
      const result = parseCommandArgs(["--force"], [boolOpt]);

      assertEquals(result.options.force, true);
    });

    it("rejects --boolean=value", () => {
      assertThrows(
        () => parseCommandArgs(["--force=yes"], [boolOpt]),
        CommandParseError,
        'The "--force" option does not accept a value.',
      );
    });

    it("throws on unknown long option", () => {
      assertThrows(
        () => parseCommandArgs(["--mystery"], []),
        CommandParseError,
        'The "--mystery" option does not exist.',
      );
    });

    it("throws when a value-taking long option is missing its value", () => {
      assertThrows(
        () => parseCommandArgs(["--scope"], [stringOpt]),
        CommandParseError,
        'The "--scope" option requires a value.',
      );
    });

    it("throws when a value-taking long option is followed by another flag", () => {
      assertThrows(
        () => parseCommandArgs(["--scope", "--force"], [stringOpt, boolOpt]),
        CommandParseError,
        'The "--scope" option requires a value.',
      );
    });
  });

  describe("short options", () => {
    it("parses -x value form", () => {
      const result = parseCommandArgs(
        ["-s", "all"],
        [{ name: "scope", shortcut: "s", type: "string" }],
      );

      assertEquals(result.options.scope, "all");
    });

    it("parses -x=value form", () => {
      const result = parseCommandArgs(
        ["-s=all"],
        [{ name: "scope", shortcut: "s", type: "string" }],
      );

      assertEquals(result.options.scope, "all");
    });

    it("toggles a boolean shortcut", () => {
      const result = parseCommandArgs(["-f"], [boolOpt]);

      assertEquals(result.options.force, true);
    });

    it("combines consecutive boolean shortcuts (-abc)", () => {
      const a: InputOption = { name: "alpha", shortcut: "a", type: "boolean" };
      const b: InputOption = { name: "beta", shortcut: "b", type: "boolean" };
      const c: InputOption = { name: "gamma", shortcut: "c", type: "boolean" };

      const result = parseCommandArgs(["-abc"], [a, b, c]);

      assertEquals(result.options.alpha, true);
      assertEquals(result.options.beta, true);
      assertEquals(result.options.gamma, true);
    });

    it("rejects combined shortcuts when one requires a value", () => {
      const a: InputOption = { name: "alpha", shortcut: "a", type: "boolean" };
      const s: InputOption = { name: "scope", shortcut: "s", type: "string" };

      assertThrows(
        () => parseCommandArgs(["-as"], [a, s]),
        CommandParseError,
        'Cannot combine the "-s" option with other flags',
      );
    });

    it("rejects -x=value on a boolean shortcut", () => {
      assertThrows(
        () => parseCommandArgs(["-f=true"], [boolOpt]),
        CommandParseError,
        'The "-f" option does not accept a value.',
      );
    });

    it("throws on unknown shortcut", () => {
      assertThrows(
        () => parseCommandArgs(["-z"], []),
        CommandParseError,
        'The "-z" option does not exist.',
      );
    });

    it("rejects -x=value when the shortcut is unknown", () => {
      assertThrows(
        () => parseCommandArgs(["-z=foo"], []),
        CommandParseError,
        'The "-z" option does not exist.',
      );
    });

    it("throws when a value-taking shortcut is missing its value (end of argv)", () => {
      assertThrows(
        () =>
          parseCommandArgs(
            ["-s"],
            [{ name: "scope", shortcut: "s", type: "string" }],
          ),
        CommandParseError,
        'The "-s" option requires a value.',
      );
    });

    it("throws when a value-taking shortcut is followed by another flag", () => {
      assertThrows(
        () =>
          parseCommandArgs(
            ["-s", "-x"],
            [{ name: "scope", shortcut: "s", type: "string" }],
          ),
        CommandParseError,
        'The "-s" option requires a value.',
      );
    });

    it("rejects combined shortcuts that include an unknown letter", () => {
      const a: InputOption = { name: "alpha", shortcut: "a", type: "boolean" };

      assertThrows(
        () => parseCommandArgs(["-az"], [a]),
        CommandParseError,
        'The "-z" option does not exist.',
      );
    });
  });

  describe("value coercion", () => {
    it("parses numeric values", () => {
      const result = parseCommandArgs(["--count", "42"], [numOpt]);

      assertEquals(result.options.count, 42);
    });

    it("rejects non-numeric values on a numeric option", () => {
      assertThrows(
        () => parseCommandArgs(["--count", "abc"], [numOpt]),
        CommandParseError,
        'The "--count" option expects a numeric value, got "abc".',
      );
    });
  });

  describe("arrays", () => {
    it("collects repeated occurrences into an array (in order)", () => {
      const result = parseCommandArgs(
        ["--tag", "a", "--tag", "b", "--tag=c"],
        [arrOpt],
      );

      assertEquals(result.options.tag, ["a", "b", "c"]);
    });

    it("rejects repeated occurrences on a non-array option", () => {
      assertThrows(
        () => parseCommandArgs(["--scope", "a", "--scope", "b"], [stringOpt]),
        CommandParseError,
        'The "--scope" option does not accept multiple values.',
      );
    });
  });

  describe("positional args & --", () => {
    it("collects unknown positionals into args", () => {
      const result = parseCommandArgs(["alpha", "beta"], []);

      assertEquals(result.args, ["alpha", "beta"]);
    });

    it("stops option parsing after --, treating subsequent tokens as positional", () => {
      const result = parseCommandArgs(
        ["--force", "--", "--unknown", "-x"],
        [boolOpt],
      );

      assertEquals(result.options.force, true);
      assertEquals(result.args, ["--unknown", "-x"]);
    });
  });

  describe("defaults & required", () => {
    it("applies a declared default when the option is omitted", () => {
      const result = parseCommandArgs(
        [],
        [{ name: "scope", type: "string", default: "all" }],
      );

      assertEquals(result.options.scope, "all");
    });

    it("defaults booleans to false when omitted", () => {
      const result = parseCommandArgs([], [boolOpt]);

      assertEquals(result.options.force, false);
    });

    it("defaults arrays to []", () => {
      const result = parseCommandArgs([], [arrOpt]);

      assertEquals(result.options.tag, []);
    });

    it("throws when a required option is omitted", () => {
      assertThrows(
        () =>
          parseCommandArgs(
            [],
            [{ name: "scope", type: "string", required: true }],
          ),
        CommandParseError,
        'The "--scope" option is required.',
      );
    });

    it("required passes when value is supplied", () => {
      const result = parseCommandArgs(
        ["--scope", "all"],
        [{ name: "scope", type: "string", required: true }],
      );

      assertEquals(result.options.scope, "all");
    });
  });

  describe("invalid definitions", () => {
    it("rejects duplicate long-name declarations", () => {
      assertThrows(
        () =>
          parseCommandArgs(
            ["--scope", "a"],
            [
              { name: "scope", type: "string" },
              { name: "scope", type: "string" },
            ],
          ),
        CommandParseError,
        'The "--scope" option is declared more than once.',
      );
    });

    it("rejects duplicate shortcut declarations", () => {
      assertThrows(
        () =>
          parseCommandArgs(
            [],
            [
              { name: "alpha", shortcut: "a", type: "boolean" },
              { name: "all", shortcut: "a", type: "boolean" },
            ],
          ),
        CommandParseError,
        'The "-a" shortcut is declared more than once.',
      );
    });
  });
});
