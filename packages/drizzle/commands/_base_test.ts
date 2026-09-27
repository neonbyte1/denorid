import type { ConsoleCommandInput } from "@denorid/core";
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { type Stub, stub } from "@std/testing/mock";
import childProcess, {
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { EventEmitter } from "node:events";
import process from "node:process";
import { afterEach, beforeEach, describe, it } from "node:test";
import denoJson from "../deno.json" with { type: "json" };
import { DRIZZLE_KIT_PACKAGE } from "../_internal.ts";
import { DrizzleCommand, runDrizzleKit } from "./_base.ts";

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
 * How the fake child process terminates right after being spawned.
 */
type ChildOutcome =
  | { readonly code: number | null; readonly signal: string | null }
  | { readonly error: Error };

/**
 * Recorded `childProcess.spawn(...)` call.
 */
interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
}

/**
 * Mutable state shared between the spawn stub and the tests of a `describe`.
 */
interface SpawnHarness {
  /** Outcome emitted by every fake child spawned during the current test. */
  outcome: ChildOutcome;
  /** Calls recorded during the current test. */
  calls: SpawnCall[];
}

/**
 * Creates an `EventEmitter` standing in for a `ChildProcess`. It emits the
 * requested outcome on the next microtask, after `runDrizzleKit` attached its
 * listeners. A spawn failure is followed by `close`, like Node.js does when
 * the executable cannot be found.
 */
function createFakeChild(outcome: ChildOutcome): ChildProcess {
  const child = new EventEmitter();

  queueMicrotask((): void => {
    if ("error" in outcome) {
      child.emit("error", outcome.error);
      child.emit("close", -2, null);
    } else {
      child.emit("close", outcome.code, outcome.signal);
    }
  });

  return child as unknown as ChildProcess;
}

/**
 * Replaces `childProcess.spawn` with a recorder returning fake children for
 * every test of the calling `describe`.
 */
function useSpawnStub(): SpawnHarness {
  const harness: SpawnHarness = {
    outcome: { code: 0, signal: null },
    calls: [],
  };
  let spawnStub: Stub | undefined;

  beforeEach((): void => {
    harness.outcome = { code: 0, signal: null };
    harness.calls = [];
    spawnStub = stub(
      childProcess,
      "spawn",
      (
        command: string,
        args: readonly string[],
        options: SpawnOptions,
      ): ChildProcess => {
        harness.calls.push({ command, args, options });

        return createFakeChild(harness.outcome);
      },
    );
  });

  afterEach((): void => {
    spawnStub?.restore();
    spawnStub = undefined;
  });

  return harness;
}

describe("DrizzleCommand", () => {
  describe("execute", () => {
    const harness = useSpawnStub();

    it("spawns drizzle-kit through deno run with inherited stdio on Deno", async () => {
      const command = new TestDrizzleCommand("generate", [
        "--config",
        "drizzle.config.ts",
      ]);

      const code = await command.execute({ args: [], options: {} });

      assertEquals(code, 0);
      assertEquals(harness.calls, [{
        command: "deno",
        args: [
          "run",
          "-A",
          "--node-modules-dir",
          `npm:${DRIZZLE_KIT_PACKAGE}`,
          "generate",
          "--config",
          "drizzle.config.ts",
        ],
        options: { stdio: "inherit", shell: false },
      }]);
    });

    it("resolves with the exit code of the child process", async () => {
      harness.outcome = { code: 42, signal: null };

      const code = await new TestDrizzleCommand("migrate").execute({
        args: [],
        options: {},
      });

      assertEquals(code, 42);
    });

    it("resolves with 1 when the child process is terminated by a signal", async () => {
      harness.outcome = { code: null, signal: "SIGTERM" };

      const code = await new TestDrizzleCommand("migrate").execute({
        args: [],
        options: {},
      });

      assertEquals(code, 1);
    });

    it("rejects with the spawn error when the launcher cannot be started", async () => {
      const error = new Error("spawn deno ENOENT");
      harness.outcome = { error };

      const rejection = await assertRejects(() =>
        new TestDrizzleCommand("migrate").execute({ args: [], options: {} })
      );

      assertStrictEquals(rejection, error);
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

      const input: ConsoleCommandInput = {
        args: ["positional"],
        options: { config: "drizzle.config.ts" },
      };

      await new Capturing().execute(input);

      assertEquals(seen, [input]);
    });
  });
});

describe("runDrizzleKit", () => {
  const harness = useSpawnStub();

  it("launches drizzle-kit through bun x with the running executable on Bun", async () => {
    const code = await runDrizzleKit(
      ["migrate", "--config", "drizzle.config.ts"],
      { Bun: {} },
      "linux",
    );

    assertEquals(code, 0);
    assertEquals(harness.calls, [{
      command: process.execPath,
      args: [
        "x",
        DRIZZLE_KIT_PACKAGE,
        "migrate",
        "--config",
        "drizzle.config.ts",
      ],
      options: { stdio: "inherit", shell: false },
    }]);
  });

  it("does not use the shell for bun x on Windows", async () => {
    await runDrizzleKit(["migrate"], { Bun: {} }, "win32");

    assertEquals(harness.calls[0].options.shell, false);
  });

  it("launches drizzle-kit through npx without a shell on Node.js", async () => {
    const code = await runDrizzleKit(
      ["generate", "--name", "init"],
      {},
      "linux",
    );

    assertEquals(code, 0);
    assertEquals(harness.calls, [{
      command: "npx",
      args: ["--yes", DRIZZLE_KIT_PACKAGE, "generate", "--name", "init"],
      options: { stdio: "inherit", shell: false },
    }]);
  });

  it("starts npx through the shell on Windows under Node.js", async () => {
    await runDrizzleKit(["generate"], {}, "win32");

    assertEquals(harness.calls, [{
      command: "npx",
      args: ["--yes", DRIZZLE_KIT_PACKAGE, "generate"],
      options: { stdio: "inherit", shell: true },
    }]);
  });
});

describe("DRIZZLE_KIT_PACKAGE", () => {
  it("pins drizzle-kit to the drizzle-orm release declared in deno.json", () => {
    const ormVersion = denoJson.imports["drizzle-orm"].replace(
      /^npm:drizzle-orm@\^?/,
      "",
    );

    assertEquals(DRIZZLE_KIT_PACKAGE, `drizzle-kit@${ormVersion}`);
  });
});
