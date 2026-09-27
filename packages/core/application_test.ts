import {
  Inject,
  Injectable,
  type InjectorContext,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@denorid/injector";
import { Logger } from "@denorid/logger";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import process from "node:process";
import { describe, it } from "node:test";
import { Application } from "./application.ts";
import type { ConsoleWriter } from "./cli/command_runner.ts";
import {
  ConsoleCommand,
  type ConsoleCommandInput,
  type ConsoleCommandInterface,
} from "./cli/mod.ts";
import { DenoridFactory } from "./denorid_factory.ts";
import { Catch, type ExceptionFilter } from "./exceptions/filter.ts";
import { ExceptionHandler } from "./exceptions/handler.ts";
import { IntrinsicException } from "./exceptions/intrinsic.ts";
import type { HostArguments } from "./host_arguments.ts";

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

function makeInjectorContext(
  onApplicationBootstrap: () => Promise<void> = () => Promise.resolve(),
): InjectorContext {
  const ctx = {
    container: { getTokensByTag: () => [] },
    resolveInternal: () => Promise.resolve(new ExceptionHandler(ctx)),
    onApplicationBootstrap,
    close: () => Promise.resolve(),
  } as unknown as InjectorContext;

  return ctx;
}

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

  it("reads the arguments after the runtime and script path from process.argv when argv is omitted", async () => {
    ledger.length = 0;
    const app = await DenoridFactory.create(RootModule);
    const originalArgv = process.argv;
    process.argv = ["/usr/bin/runtime", "/app/main.ts", "ping", "--loud"];

    try {
      const code = await app.runCommandLine(undefined, {
        stdout: new BufferWriter(),
        stderr: new BufferWriter(),
        decorated: false,
      });

      assertEquals(code, 42);
      assertEquals(ledger, ["PONG"]);
    } finally {
      process.argv = originalArgv;
    }
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

describe("Application[Symbol.asyncDispose]", () => {
  it("shuts down and disposes providers of an application that was never initialized", async () => {
    const calls: string[] = [];

    @Injectable()
    class Connection implements OnModuleDestroy, AsyncDisposable {
      public onModuleDestroy(): void {
        calls.push("destroy");
      }

      public [Symbol.asyncDispose](): Promise<void> {
        calls.push("dispose");
        return Promise.resolve();
      }
    }

    @Module({ providers: [Connection] })
    class AppModule {}

    {
      await using _app = await DenoridFactory.create(AppModule, {
        logger: new Logger("test", { levels: [] }),
      });
    }

    assertEquals(calls, ["destroy", "dispose"]);
  });
});

describe("Application.init", () => {
  it("registers the exception filters before the onApplicationBootstrap hooks run", async () => {
    class QueueError extends IntrinsicException {}

    @Catch(QueueError)
    class QueueErrorFilter implements ExceptionFilter<QueueError> {
      public catch(): string {
        return "filtered";
      }
    }

    @Injectable()
    class QueueConsumer implements OnApplicationBootstrap {
      @Inject(ExceptionHandler)
      private readonly exceptionHandler!: ExceptionHandler;

      public result?: unknown;

      public async onApplicationBootstrap(): Promise<void> {
        this.result = await this.exceptionHandler.handle(
          new QueueError("consumer failed"),
          {} as HostArguments,
        );
      }
    }

    @Module({ providers: [QueueErrorFilter, QueueConsumer] })
    class WorkerModule {}

    await using app = await DenoridFactory.create(WorkerModule, {
      logger: new Logger("test", { levels: [] }),
    });

    await app.init();

    assertEquals((await app.get(QueueConsumer)).result, "filtered");
  });

  it("shares one initialization between concurrent and later calls", async () => {
    const ctx = makeInjectorContext();
    const bootstrapSpy = spy(ctx, "onApplicationBootstrap");
    const app = new Application(RootModule, ctx, {});

    await Promise.all([app.init(), app.init()]);
    await app.init();

    assertSpyCalls(bootstrapSpy, 1);
  });

  it("initializes again after a failed initialization", async () => {
    let failures = 1;
    const ctx = makeInjectorContext(() =>
      failures-- > 0
        ? Promise.reject(new Error("bootstrap failed"))
        : Promise.resolve()
    );
    const bootstrapSpy = spy(ctx, "onApplicationBootstrap");
    const app = new Application(RootModule, ctx, {});

    await assertRejects(() => app.init(), Error, "bootstrap failed");
    await app.init();
    await app.init();

    assertSpyCalls(bootstrapSpy, 2);
  });

  it("rejects once the application was closed", async () => {
    const ctx = makeInjectorContext();
    const bootstrapSpy = spy(ctx, "onApplicationBootstrap");
    const app = new Application(RootModule, ctx, {});

    await app.close();

    await assertRejects(
      () => app.init(),
      Error,
      "Cannot initialize an application that was closed",
    );
    assertSpyCalls(bootstrapSpy, 0);
  });
});

describe("Application.close", () => {
  it("waits for a running initialization before shutting down", async () => {
    const events: string[] = [];
    const { promise: bootstrapped, resolve: bootstrap } = Promise
      .withResolvers<void>();
    const ctx = makeInjectorContext(async () => {
      await bootstrapped;
      events.push("bootstrap");
    });
    ctx.close = (): Promise<void> => {
      events.push("close");
      return Promise.resolve();
    };
    const app = new Application(RootModule, ctx, {});

    const initialized = app.init();
    const closed = app.close();

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertEquals(events, []);

    bootstrap();
    await Promise.all([initialized, closed]);

    assertEquals(events, ["bootstrap", "close"]);
  });

  it("shuts down after a failed initialization", async () => {
    const { promise: bootstrapped, reject: fail } = Promise.withResolvers<
      void
    >();
    const ctx = makeInjectorContext(() => bootstrapped);
    const closeSpy = spy(ctx, "close");
    const app = new Application(RootModule, ctx, {});

    const initialized = app.init();
    const closed = app.close();

    fail(new Error("bootstrap failed"));

    await assertRejects(() => initialized, Error, "bootstrap failed");
    await closed;
    assertSpyCalls(closeSpy, 1);
  });
});
