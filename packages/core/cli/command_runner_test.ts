import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { CLI_OPTIONS_METADATA } from "../_constants.ts";
import type {
  ConsoleCommandInput,
  ConsoleCommandInterface,
} from "./command_interface.ts";
import { ConsoleCommandRunner, type ConsoleWriter } from "./command_runner.ts";
import { ConsoleCommand, Option } from "./decorator.ts";
import type { InputOption } from "./options.ts";

class BufferWriter implements ConsoleWriter {
  private chunks: Uint8Array[] = [];

  public write(p: Uint8Array): number {
    this.chunks.push(new Uint8Array(p));
    return p.length;
  }

  public text(): string {
    return new TextDecoder().decode(
      this.chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.length + chunk.length);
        merged.set(acc, 0);
        merged.set(chunk, acc.length);
        return merged;
      }, new Uint8Array(0)),
    );
  }
}

@ConsoleCommand({
  command: "cache:clear",
  description: "Clears the cache",
  options: [{ name: "scope", type: "string", default: "all" }],
})
class ClearCache implements ConsoleCommandInterface {
  public lastInput?: ConsoleCommandInput;

  public execute(input: ConsoleCommandInput): number {
    this.lastInput = input;
    return 0;
  }
}

@ConsoleCommand({
  command: "user:create",
  description: "Creates a user",
  help: "Creates a brand new user in the system.",
})
@Option({ name: "name", type: "string", required: true })
@Option({ name: "admin", shortcut: "a", type: "boolean" })
class CreateUser implements ConsoleCommandInterface {
  public lastInput?: ConsoleCommandInput;
  public execute(input: ConsoleCommandInput): number {
    this.lastInput = input;
    return 7;
  }
}

@ConsoleCommand({ command: "boom" })
class ExplosiveCommand implements ConsoleCommandInterface {
  public execute(_: ConsoleCommandInput): number {
    throw new Error("kaboom");
  }
}

@ConsoleCommand({ command: "silent" })
class VoidCommand implements ConsoleCommandInterface {
  public execute(_: ConsoleCommandInput): number {
    return undefined as unknown as number;
  }
}

@ConsoleCommand({ command: "shout" })
class StringThrowCommand implements ConsoleCommandInterface {
  public execute(_: ConsoleCommandInput): number {
    throw "raw string error";
  }
}

@ConsoleCommand({ command: "trapped" })
class TrappedCommand implements ConsoleCommandInterface {
  public execute(_: ConsoleCommandInput): number {
    return 0;
  }
}

const trappedMeta = (TrappedCommand as unknown as {
  [Symbol.metadata]: Record<symbol, unknown>;
})[Symbol.metadata];
const trappedOption: InputOption = Object.defineProperty(
  {} as InputOption,
  "name",
  {
    get(): never {
      throw new TypeError("simulated non-parse failure");
    },
    enumerable: true,
  },
);
trappedMeta[CLI_OPTIONS_METADATA] = [trappedOption];

function makeCtx(
  tokens: Type[],
  instances: Map<Type, ConsoleCommandInterface>,
): InjectorContext {
  return {
    container: {
      getTokensByTag: () => tokens,
    },
    resolveInternal: <T>(token: Type<T>): Promise<T> =>
      Promise.resolve(instances.get(token as Type) as T),
  } as unknown as InjectorContext;
}

function makeRunner(opts: {
  tokens?: Type[];
  instances?: Map<Type, ConsoleCommandInterface>;
  decorated?: boolean;
}): {
  runner: ConsoleCommandRunner;
  stdout: BufferWriter;
  stderr: BufferWriter;
} {
  const stdout = new BufferWriter();
  const stderr = new BufferWriter();
  const runner = new ConsoleCommandRunner(
    makeCtx(opts.tokens ?? [], opts.instances ?? new Map()),
    {
      appName: "TestApp",
      stdout,
      stderr,
      decorated: opts.decorated ?? false,
    },
  );

  return { runner, stdout, stderr };
}

describe("ConsoleCommandRunner.run()", () => {
  describe("when no command is given", () => {
    it("prints the command list and returns 0", async () => {
      const cache = new ClearCache();
      const { runner, stdout } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, cache]]),
      });

      const code = await runner.run([]);

      assertEquals(code, 0);
      const text = stdout.text();
      assertStringIncludes(text, "TestApp");
      assertStringIncludes(text, "Usage:");
      assertStringIncludes(text, "Available commands:");
      assertStringIncludes(text, "cache:clear");
      assertStringIncludes(text, "Clears the cache");
    });

    it("lists the global --no-color and --help flags", async () => {
      const { runner, stdout } = makeRunner({});

      await runner.run([]);

      const text = stdout.text();
      assertStringIncludes(text, "--no-color");
      assertStringIncludes(text, "-h, --help");
    });
  });

  describe("`list` & `help` built-ins", () => {
    it("`list` renders the command list", async () => {
      const { runner, stdout } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, new ClearCache()]]),
      });

      const code = await runner.run(["list"]);

      assertEquals(code, 0);
      assertStringIncludes(stdout.text(), "cache:clear");
    });

    it("`help <cmd>` renders the help for that command", async () => {
      const { runner, stdout } = makeRunner({
        tokens: [CreateUser as Type],
        instances: new Map([[CreateUser as Type, new CreateUser()]]),
      });

      const code = await runner.run(["help", "user:create"]);

      assertEquals(code, 0);
      const text = stdout.text();
      assertStringIncludes(text, "Description:");
      assertStringIncludes(text, "Creates a user");
      assertStringIncludes(text, "Usage:");
      assertStringIncludes(text, "user:create [options]");
      assertStringIncludes(text, "Help:");
      assertStringIncludes(text, "Creates a brand new user");
      assertStringIncludes(text, "--name=NAME");
      assertStringIncludes(text, "-a, --admin");
    });

    it("`help` without target falls back to the listing", async () => {
      const { runner, stdout } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, new ClearCache()]]),
      });

      const code = await runner.run(["help"]);

      assertEquals(code, 0);
      assertStringIncludes(stdout.text(), "Available commands:");
    });

    it("`help <unknown>` returns 1 and writes an error", async () => {
      const { runner, stderr } = makeRunner({});

      const code = await runner.run(["help", "mystery"]);

      assertEquals(code, 1);
      assertStringIncludes(stderr.text(), 'Command "mystery" is not defined.');
    });
  });

  describe("--help / -h on a known command", () => {
    it("--help renders that command's help and returns 0 without executing", async () => {
      const cache = new ClearCache();
      const { runner, stdout } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, cache]]),
      });

      const code = await runner.run(["cache:clear", "--help"]);

      assertEquals(code, 0);
      assertEquals(cache.lastInput, undefined);
      assertStringIncludes(stdout.text(), "cache:clear [options]");
    });

    it("-h is treated identically to --help", async () => {
      const cache = new ClearCache();
      const { runner, stdout } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, cache]]),
      });

      const code = await runner.run(["cache:clear", "-h"]);

      assertEquals(code, 0);
      assertEquals(cache.lastInput, undefined);
      assertStringIncludes(stdout.text(), "cache:clear");
    });
  });

  describe("command execution", () => {
    it("resolves the command, parses argv and forwards the input", async () => {
      const cache = new ClearCache();
      const { runner } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, cache]]),
      });

      const code = await runner.run(["cache:clear", "--scope", "users"]);

      assertEquals(code, 0);
      assertEquals(cache.lastInput?.options.scope, "users");
      assertEquals(cache.lastInput?.args, []);
    });

    it("applies declared option defaults when the flag is omitted", async () => {
      const cache = new ClearCache();
      const { runner } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, cache]]),
      });

      await runner.run(["cache:clear"]);

      assertEquals(cache.lastInput?.options.scope, "all");
    });

    it("propagates the command's exit code", async () => {
      const user = new CreateUser();
      const { runner } = makeRunner({
        tokens: [CreateUser as Type],
        instances: new Map([[CreateUser as Type, user]]),
      });

      const code = await runner.run([
        "user:create",
        "--name",
        "alice",
        "-a",
      ]);

      assertEquals(code, 7);
      assertEquals(user.lastInput?.options.name, "alice");
      assertEquals(user.lastInput?.options.admin, true);
    });

    it("catches synchronous throws and writes the message to stderr", async () => {
      const { runner, stderr } = makeRunner({
        tokens: [ExplosiveCommand as Type],
        instances: new Map([[
          ExplosiveCommand as Type,
          new ExplosiveCommand(),
        ]]),
      });

      const code = await runner.run(["boom"]);

      assertEquals(code, 1);
      assertStringIncludes(stderr.text(), "kaboom");
    });
  });

  describe("errors", () => {
    it("rejects an unknown command and prints suggestions when available", async () => {
      const { runner, stderr } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, new ClearCache()]]),
      });

      const code = await runner.run(["cache:flush"]);

      assertEquals(code, 1);
      const text = stderr.text();
      assertStringIncludes(text, 'Command "cache:flush" is not defined.');
      assertStringIncludes(text, "Did you mean");
      assertStringIncludes(text, "cache:clear");
    });

    it("on parse failure prints the error AND the command's help block", async () => {
      const { runner, stderr, stdout } = makeRunner({
        tokens: [CreateUser as Type],
        instances: new Map([[CreateUser as Type, new CreateUser()]]),
      });

      const code = await runner.run(["user:create"]);

      assertEquals(code, 1);
      assertStringIncludes(stderr.text(), 'The "--name" option is required.');
      assertStringIncludes(stdout.text(), "user:create [options]");
    });

    it("--no-color suppresses ANSI escapes in the listing output", async () => {
      const { runner, stdout } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, new ClearCache()]]),
        decorated: true,
      });

      await runner.run(["--no-color"]);

      // deno-lint-ignore no-control-regex
      const hasAnsi = /\x1b\[/.test(stdout.text());
      assertEquals(hasAnsi, false);
    });

    it("when decoration is enabled the listing contains ANSI escapes", async () => {
      const { runner, stdout } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, new ClearCache()]]),
        decorated: true,
      });

      await runner.run([]);

      // deno-lint-ignore no-control-regex
      const hasAnsi = /\x1b\[/.test(stdout.text());
      assertEquals(hasAnsi, true);
    });
  });

  describe("execution return values", () => {
    it("falls back to exit code 0 when execute() returns void", async () => {
      const { runner } = makeRunner({
        tokens: [VoidCommand as Type],
        instances: new Map([[VoidCommand as Type, new VoidCommand()]]),
      });

      const code = await runner.run(["silent"]);

      assertEquals(code, 0);
    });

    it("stringifies non-Error throws when writing them to stderr", async () => {
      const { runner, stderr } = makeRunner({
        tokens: [StringThrowCommand as Type],
        instances: new Map([[
          StringThrowCommand as Type,
          new StringThrowCommand(),
        ]]),
      });

      const code = await runner.run(["shout"]);

      assertEquals(code, 1);
      assertStringIncludes(stderr.text(), "raw string error");
    });
  });

  describe("suggestions", () => {
    it("omits the did-you-mean block when no candidate is similar", async () => {
      const { runner, stderr } = makeRunner({
        tokens: [ClearCache as Type],
        instances: new Map([[ClearCache as Type, new ClearCache()]]),
      });

      const code = await runner.run(["totally-unrelated"]);

      assertEquals(code, 1);
      const text = stderr.text();
      assertStringIncludes(text, 'Command "totally-unrelated" is not defined.');
      assertEquals(text.includes("Did you mean"), false);
    });
  });

  describe("non-parse-error propagation", () => {
    it("re-throws errors that are not CommandParseError", async () => {
      const { runner } = makeRunner({
        tokens: [TrappedCommand as Type],
        instances: new Map([[TrappedCommand as Type, new TrappedCommand()]]),
      });

      let thrown: unknown;
      try {
        await runner.run(["trapped"]);
      } catch (error) {
        thrown = error;
      }

      assertEquals(thrown instanceof TypeError, true);
      assertStringIncludes(
        thrown instanceof Error ? thrown.message : "",
        "simulated non-parse failure",
      );
    });
  });

  describe("constructor defaults", () => {
    it("uses 'Denorid' as the default appName and writes to Deno.stdout", async () => {
      const written: string[] = [];
      using _stdout = stub(
        Deno.stdout,
        "write",
        (p: Uint8Array): Promise<number> => {
          written.push(new TextDecoder().decode(p));
          return Promise.resolve(p.length);
        },
      );
      using _stderr = stub(
        Deno.stderr,
        "write",
        (p: Uint8Array): Promise<number> => Promise.resolve(p.length),
      );
      using _terminal = stub(Deno.stdout, "isTerminal", () => false);

      const runner = new ConsoleCommandRunner(
        makeCtx([], new Map()),
      );

      const code = await runner.run([]);

      assertEquals(code, 0);
      assertStringIncludes(written.join(""), "Denorid");
    });

    it("auto-detects ANSI support when decorated is not supplied", async () => {
      const written: string[] = [];
      using _stdout = stub(
        Deno.stdout,
        "write",
        (p: Uint8Array): Promise<number> => {
          written.push(new TextDecoder().decode(p));
          return Promise.resolve(p.length);
        },
      );
      using _terminal = stub(Deno.stdout, "isTerminal", () => true);
      const previousNoColor = Deno.env.get("NO_COLOR");
      Deno.env.delete("NO_COLOR");

      try {
        const runner = new ConsoleCommandRunner(
          makeCtx(
            [ClearCache as Type],
            new Map([[
              ClearCache as Type,
              new ClearCache(),
            ]]),
          ),
          { appName: "AutoDetect" },
        );

        await runner.run([]);

        // deno-lint-ignore no-control-regex
        const hasAnsi = /\x1b\[/.test(written.join(""));
        assertEquals(hasAnsi, true);
      } finally {
        if (previousNoColor !== undefined) {
          Deno.env.set("NO_COLOR", previousNoColor);
        }
      }
    });

    it("routes error output to Deno.stderr by default", async () => {
      using _stdout = stub(
        Deno.stdout,
        "write",
        (p: Uint8Array): Promise<number> => Promise.resolve(p.length),
      );
      const stderrChunks: string[] = [];
      using _stderr = stub(
        Deno.stderr,
        "write",
        (p: Uint8Array): Promise<number> => {
          stderrChunks.push(new TextDecoder().decode(p));
          return Promise.resolve(p.length);
        },
      );
      using _terminal = stub(Deno.stdout, "isTerminal", () => false);

      const runner = new ConsoleCommandRunner(
        makeCtx([], new Map()),
      );

      const code = await runner.run(["unknown:cmd"]);

      assertEquals(code, 1);
      assertStringIncludes(
        stderrChunks.join(""),
        'Command "unknown:cmd" is not defined.',
      );
    });
  });
});
