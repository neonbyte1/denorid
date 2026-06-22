import type { ConsoleCommandInput } from "@denorid/core";
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { DrizzleCommand } from "./_base.ts";

/**
 * Minimal concrete subclass exposing the abstract surface so we can exercise
 * {@linkcode DrizzleCommand.execute} end-to-end.
 */
class TestDrizzleCommand extends DrizzleCommand {
  public constructor(
    kitCommand: string,
    private readonly forwarded: string[] = [],
  ) {
    super(kitCommand);
  }

  protected override buildCommandArguments(
    _input: ConsoleCommandInput,
  ): string[] {
    return this.forwarded;
  }
}

/**
 * Recorded `new Deno.Command(...)` call.
 */
interface RecordedSpawn {
  command: string | URL;
  options: Deno.CommandOptions;
}

/**
 * Test double standing in for {@linkcode Deno.Command} during a test. We need
 * a real constructor (the std mock `stub` invokes its replacement via
 * `.apply`, which class constructors reject), so we wire it up by hand.
 */
function withDenoCommandStub<T>(
  exitCode: number,
  fn: (spawns: RecordedSpawn[]) => Promise<T>,
): Promise<T> {
  const spawns: RecordedSpawn[] = [];

  class FakeCommand {
    public constructor(
      command: string | URL,
      options: Deno.CommandOptions = {},
    ) {
      spawns.push({ command, options });
    }

    public output(): Promise<Deno.CommandOutput> {
      return Promise.resolve({
        code: exitCode,
        success: exitCode === 0,
        signal: null,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  }

  // Cast: deliberately swap a Deno built-in for a test double. The runtime
  // only relies on the constructor + `.output()` surface, which `FakeCommand`
  // satisfies; the cast is confined to this helper.
  const denoMut = Deno as unknown as { Command: typeof Deno.Command };
  const original = denoMut.Command;
  denoMut.Command = FakeCommand as unknown as typeof Deno.Command;

  return fn(spawns).finally(() => {
    denoMut.Command = original;
  });
}

describe("DrizzleCommand", () => {
  describe("execute", () => {
    it("invokes drizzle-kit through deno run with the subclass arguments", async () => {
      await withDenoCommandStub(0, async (spawns) => {
        const command = new TestDrizzleCommand("generate", [
          "--config",
          "drizzle.config.ts",
        ]);

        const code = await command.execute({ args: [], options: {} });

        assertEquals(code, 0);
        assertEquals(spawns.length, 1);
        assertEquals(spawns[0].command, "deno");
        assertEquals(spawns[0].options.args, [
          "run",
          "-A",
          "--node-modules-dir",
          "npm:drizzle-kit",
          "generate",
          "--config",
          "drizzle.config.ts",
        ]);
        assertEquals(spawns[0].options.stdout, "inherit");
        assertEquals(spawns[0].options.stderr, "inherit");
        assertEquals(spawns[0].options.stdin, "inherit");
      });
    });

    it("returns the child process exit code unchanged on failure", async () => {
      await withDenoCommandStub(42, async () => {
        const command = new TestDrizzleCommand("migrate");

        const code = await command.execute({ args: [], options: {} });

        assertEquals(code, 42);
      });
    });

    it("appends no extra arguments when the subclass returns an empty array", async () => {
      await withDenoCommandStub(0, async (spawns) => {
        const command = new TestDrizzleCommand("migrate");

        await command.execute({ args: [], options: {} });

        assertEquals(spawns[0].options.args, [
          "run",
          "-A",
          "--node-modules-dir",
          "npm:drizzle-kit",
          "migrate",
        ]);
      });
    });

    it("forwards the parsed input into buildCommandArguments", async () => {
      const seen: ConsoleCommandInput[] = [];

      class Capturing extends DrizzleCommand {
        public constructor() {
          super("generate");
        }

        protected override buildCommandArguments(
          input: ConsoleCommandInput,
        ): string[] {
          seen.push(input);

          return [];
        }
      }

      await withDenoCommandStub(0, async () => {
        const input: ConsoleCommandInput = {
          args: ["positional"],
          options: { config: "drizzle.config.ts" },
        };

        await new Capturing().execute(input);

        assertEquals(seen.length, 1);
        assertEquals(seen[0], input);
      });
    });
  });
});
