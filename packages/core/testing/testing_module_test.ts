import {
  type InjectionToken,
  Injectable,
  InjectorContext,
  Module,
  type OnBeforeApplicationShutdown,
  type OnModuleDestroy,
  type Tag,
  Tags,
} from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertNotStrictEquals,
  assertStrictEquals,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import process from "node:process";
import { describe, it } from "node:test";
import type {
  ConsoleCommandInput,
  ConsoleCommandInterface,
} from "../cli/command_interface.ts";
import type { ConsoleWriter } from "../cli/command_runner.ts";
import { ConsoleCommand } from "../cli/decorator.ts";
import { TestingModule } from "./testing_module.ts";

function makeCtx(overrides?: Record<string, unknown>): InjectorContext {
  return {
    container: {
      getByTag: (_tag: Tag) => Promise.resolve([]),
      ...(overrides?.container as Record<string, unknown> | undefined),
    },
    resolveInternal: (_token: InjectionToken) => Promise.resolve(undefined),
    onApplicationBootstrap: () => Promise.resolve(),
    onBeforeApplicationShutdown: () => Promise.resolve(),
    onApplicationShutdown: () => Promise.resolve(),
    ...overrides,
  } as unknown as InjectorContext;
}

@ConsoleCommand({
  command: "greet",
  options: [{ name: "name", type: "string" }],
})
class GreetCommand implements ConsoleCommandInterface {
  public lastInput?: ConsoleCommandInput;

  public execute(input: ConsoleCommandInput): number {
    this.lastInput = input;
    return 5;
  }
}

class TextWriter implements ConsoleWriter {
  public text: string = "";

  public write(p: Uint8Array): number {
    this.text += new TextDecoder().decode(p);
    return p.length;
  }
}

function makeCommandCtx(command: GreetCommand): InjectorContext {
  return makeCtx({
    container: { getTokensByTag: () => [GreetCommand] },
    resolveInternal: (_token: InjectionToken) => Promise.resolve(command),
  });
}

describe(TestingModule.name, () => {
  describe("get()", () => {
    it("returns one transient instance per contextId", async () => {
      @Injectable({ mode: "transient" })
      class Transient {}

      @Module({ providers: [Transient] })
      class AppModule {}

      await using module = new TestingModule(
        await InjectorContext.create(AppModule),
      );

      const first = await module.get(Transient, { contextId: "ctx-1" });

      assertStrictEquals(
        await module.get(Transient, { contextId: "ctx-1" }),
        first,
      );
      assertNotStrictEquals(
        await module.get(Transient, { contextId: "ctx-2" }),
        first,
      );
      assertNotStrictEquals(await module.get(Transient), first);
    });
  });

  describe("getByTag()", () => {
    it("returns the transient instances of the given contextId", async () => {
      const TAG = Symbol("tag");

      @Tags(TAG)
      @Injectable({ mode: "transient" })
      class Tagged {}

      @Module({ providers: [Tagged] })
      class AppModule {}

      await using module = new TestingModule(
        await InjectorContext.create(AppModule),
      );

      const [first] = await module.getByTag<Tagged>([TAG], { contextId: "a" });
      const [second, third] = await module.getByTag<Tagged>([TAG, TAG], {
        contextId: "a",
      });

      assertInstanceOf(first, Tagged);
      assertStrictEquals(second, first);
      assertStrictEquals(third, first);
      assertNotStrictEquals(
        (await module.getByTag<Tagged>([TAG], { contextId: "b" }))[0],
        first,
      );
      assertNotStrictEquals((await module.getByTag<Tagged>(TAG))[0], first);
    });
  });

  describe("init()", () => {
    it("calls ctx.onApplicationBootstrap()", async () => {
      const ctx = makeCtx();
      const bootstrapSpy = spy(ctx, "onApplicationBootstrap");
      const module = new TestingModule(ctx);

      await module.init();

      assertSpyCalls(bootstrapSpy, 1);
    });
  });

  describe("[Symbol.asyncDispose]()", () => {
    it("closes the injector context when an `await using` block exits", async () => {
      const calls: string[] = [];

      @Injectable()
      class Service
        implements OnBeforeApplicationShutdown, OnModuleDestroy, Disposable {
        public onBeforeApplicationShutdown(): void {
          calls.push("before");
        }

        public onModuleDestroy(): void {
          calls.push("destroy");
        }

        public [Symbol.dispose](): void {
          calls.push("dispose");
        }
      }

      @Module({ providers: [Service] })
      class AppModule {}

      {
        await using _module = new TestingModule(
          await InjectorContext.create(AppModule),
        );
        assertEquals(calls, []);
      }

      assertEquals(calls, ["before", "destroy", "dispose"]);
    });
  });

  describe("runCommandLine()", () => {
    it("bootstraps the context, runs the given argv and returns the exit code", async () => {
      const command = new GreetCommand();
      const ctx = makeCommandCtx(command);
      const bootstrapSpy = spy(ctx, "onApplicationBootstrap");
      const stderr = new TextWriter();
      const module = new TestingModule(ctx);

      const code = await module.runCommandLine(["greet", "--name=Ada"], {
        stdout: new TextWriter(),
        stderr,
        decorated: false,
      });

      assertEquals(code, 5);
      assertEquals(command.lastInput?.options.name, "Ada");
      assertSpyCalls(bootstrapSpy, 1);
      assertEquals(stderr.text, "");
    });

    it("reads the arguments after the runtime and script path from process.argv when argv is omitted", async () => {
      const command = new GreetCommand();
      const module = new TestingModule(makeCommandCtx(command));
      const originalArgv = process.argv;
      process.argv = [
        "/usr/bin/runtime",
        "/app/main.ts",
        "greet",
        "--name=Bob",
      ];

      try {
        const code = await module.runCommandLine(undefined, {
          stdout: new TextWriter(),
          stderr: new TextWriter(),
          decorated: false,
        });

        assertEquals(code, 5);
        assertEquals(command.lastInput?.options.name, "Bob");
      } finally {
        process.argv = originalArgv;
      }
    });
  });
});
