import { Module } from "@denorid/injector";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ConsoleWriter } from "./cli/command_runner.ts";
import {
  ConsoleCommand,
  type ConsoleCommandInput,
  type ConsoleCommandInterface,
} from "./cli/mod.ts";
import { DenoridFactory } from "./denorid_factory.ts";

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

const ledger: string[] = [];

@ConsoleCommand({
  command: "ping",
  description: "Replies with pong",
  options: [{ name: "loud", type: "boolean" }],
})
class PingCommand implements ConsoleCommandInterface {
  public execute(input: ConsoleCommandInput): number {
    const msg = input.options.loud === true ? "PONG" : "pong";
    ledger.push(msg);
    return 42;
  }
}

@Module({ providers: [PingCommand] })
class RootModule {}

describe("Application.runCommandLine", () => {
  it("bootstraps DI, runs the command, and propagates the exit code", async () => {
    ledger.length = 0;
    const app = await DenoridFactory.create(RootModule);
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const code = await app.runCommandLine(["ping", "--loud"], {
      stdout,
      stderr,
      decorated: false,
    });

    assertEquals(code, 42);
    assertEquals(ledger, ["PONG"]);
  });

  it("prints the command list when no command is given and exits 0", async () => {
    const app = await DenoridFactory.create(RootModule);
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const code = await app.runCommandLine([], {
      stdout,
      stderr,
      decorated: false,
    });

    assertEquals(code, 0);
    const text = stdout.text();
    assertStringIncludes(text, "ping");
    assertStringIncludes(text, "Replies with pong");
    assertStringIncludes(text, "--no-color");
    assertStringIncludes(text, "-h, --help");
  });

  it("renders per-command help when --help is supplied", async () => {
    const app = await DenoridFactory.create(RootModule);
    const stdout = new BufferWriter();

    const code = await app.runCommandLine(["ping", "--help"], {
      stdout,
      stderr: new BufferWriter(),
      decorated: false,
    });

    assertEquals(code, 0);
    const text = stdout.text();
    assertStringIncludes(text, "Description:");
    assertStringIncludes(text, "Replies with pong");
    assertStringIncludes(text, "Usage:");
    assertStringIncludes(text, "ping [options]");
    assertStringIncludes(text, "--loud");
  });

  it("reports unknown commands on stderr with exit code 1", async () => {
    const app = await DenoridFactory.create(RootModule);
    const stderr = new BufferWriter();

    const code = await app.runCommandLine(["mystery"], {
      stdout: new BufferWriter(),
      stderr,
      decorated: false,
    });

    assertEquals(code, 1);
    assertStringIncludes(stderr.text(), 'Command "mystery" is not defined.');
  });

  it("--no-color strips ANSI escapes even when terminal would have decorated", async () => {
    const app = await DenoridFactory.create(RootModule);
    const stdout = new BufferWriter();

    await app.runCommandLine(["--no-color"], {
      stdout,
      stderr: new BufferWriter(),
      decorated: true,
    });

    // deno-lint-ignore no-control-regex
    const hasAnsi = /\x1b\[/.test(stdout.text());
    assertEquals(hasAnsi, false);
  });

  it("discovers commands declared in imported (microservice) modules", async () => {
    @ConsoleCommand({
      command: "queue:status",
      description: "Reports queue depth",
    })
    class QueueStatusCommand implements ConsoleCommandInterface {
      public execute(_: ConsoleCommandInput): number {
        return 0;
      }
    }

    @Module({ providers: [QueueStatusCommand], exports: [QueueStatusCommand] })
    class QueueModule {}

    @Module({ imports: [QueueModule], providers: [PingCommand] })
    class CompositeRoot {}

    const app = await DenoridFactory.create(CompositeRoot);
    const stdout = new BufferWriter();

    const code = await app.runCommandLine([], {
      stdout,
      stderr: new BufferWriter(),
      decorated: false,
    });

    assertEquals(code, 0);
    const text = stdout.text();
    assertStringIncludes(text, "ping");
    assertStringIncludes(text, "queue:status");
    assertStringIncludes(text, "Reports queue depth");
  });
});
