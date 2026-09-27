import type { InjectionToken, InjectorContext, Tag } from "@denorid/injector";
import { assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
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
    it("delegates to ctx.resolveInternal with the token", async () => {
      const token = class MyService {};
      const instance = new token();
      const ctx = makeCtx({
        resolveInternal: (_t: InjectionToken) => Promise.resolve(instance),
      });
      const resolveSpy = spy(ctx, "resolveInternal");
      const module = new TestingModule(ctx);

      const result = await module.get(token);

      assertEquals(result, instance);
      assertSpyCalls(resolveSpy, 1);
      assertSpyCall(resolveSpy, 0, { args: [token] });
    });

    it("ignores options and always resolves via resolveInternal", async () => {
      const token = "MY_TOKEN";
      const ctx = makeCtx({
        resolveInternal: (_t: InjectionToken) => Promise.resolve("value"),
      });
      const resolveSpy = spy(ctx, "resolveInternal");
      const module = new TestingModule(ctx);

      await module.get(token as InjectionToken, { strict: false });

      assertSpyCalls(resolveSpy, 1);
    });
  });

  describe("getByTag()", () => {
    it("delegates to ctx.container.getByTag for a single tag", async () => {
      const TAG = Symbol("tag");
      const items = [{ name: "a" }, { name: "b" }];
      const ctx = makeCtx({
        container: {
          getByTag: (_tag: Tag) => Promise.resolve(items),
        },
      });
      const getByTagSpy = spy(ctx.container, "getByTag");
      const module = new TestingModule(ctx);

      const result = await module.getByTag(TAG);

      assertEquals(result, items);
      assertSpyCalls(getByTagSpy, 1);
      assertSpyCall(getByTagSpy, 0, { args: [TAG] });
    });

    it("calls ctx.container.getByTag for each tag and flattens results", async () => {
      const TAG_A = Symbol("a");
      const TAG_B = Symbol("b");
      const resultsA = [{ name: "a" }];
      const resultsB = [{ name: "b" }, { name: "c" }];
      const ctx = makeCtx({
        container: {
          getByTag: (tag: Tag) =>
            Promise.resolve(tag === TAG_A ? resultsA : resultsB),
        },
      });
      const getByTagSpy = spy(ctx.container, "getByTag");
      const module = new TestingModule(ctx);

      const result = await module.getByTag([TAG_A, TAG_B], { contextId: "x" });

      assertEquals(result, [...resultsA, ...resultsB]);
      assertSpyCalls(getByTagSpy, 2);
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

  describe("close()", () => {
    it("calls onBeforeApplicationShutdown then onApplicationShutdown in order", async () => {
      const calls: string[] = [];
      const ctx = makeCtx({
        onBeforeApplicationShutdown: () => {
          calls.push("before");
          return Promise.resolve();
        },
        onApplicationShutdown: () => {
          calls.push("shutdown");
          return Promise.resolve();
        },
      });
      const module = new TestingModule(ctx);

      await module.close();

      assertEquals(calls, ["before", "shutdown"]);
    });
  });

  describe("[Symbol.asyncDispose]()", () => {
    it("runs the shutdown hooks when an `await using` block exits", async () => {
      const calls: string[] = [];
      const ctx = makeCtx({
        onBeforeApplicationShutdown: () => {
          calls.push("before");
          return Promise.resolve();
        },
        onApplicationShutdown: () => {
          calls.push("shutdown");
          return Promise.resolve();
        },
      });

      {
        await using _module = new TestingModule(ctx);
        assertEquals(calls, []);
      }

      assertEquals(calls, ["before", "shutdown"]);
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
