import type { Kv, KvKey } from "@deno/kv";
import type { CanActivate, ExecutionContext } from "@denorid/core";
import {
  ExceptionHandler,
  ForbiddenException,
  RpcHostArguments,
  UseGuards,
} from "@denorid/core";
import { Test, type TestingModule } from "@denorid/core/testing";
import {
  Injectable,
  InjectorContext,
  type ModuleRef,
  type Type,
} from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { stub } from "@std/testing/mock";
import { describe, it } from "node:test";
import { QUEUE_HANDLER } from "../_constants.ts";
import type { ConnectionEntry } from "../_connections.ts";
import { KvConnections } from "../connections.ts";
import { KvModule } from "../module.ts";
import { Queued, QueueHandler } from "./decorator.ts";
import { KvQueueListener } from "./listener.ts";
import { KvQueue } from "./queue.ts";

type ListenerCallback = (msg: unknown) => void | Promise<void>;

interface ListenerHarness {
  callbacks: Record<string, ListenerCallback[]>;
  exceptionCalls: unknown[][];
  getCalls: unknown[][];
  listens: Record<string, PromiseWithResolvers<void>[]>;
  loggerErrors: unknown[][];
  loggerWarnings: unknown[][];
  resolutionCalls: unknown[][];
  scopes: string[];
  listener: KvQueueListener;
}

class PayloadDto {
  value?: number;
}

function createHarness(
  harnessOptions: {
    entries: Record<string, ConnectionEntry>;
    handlers?: Type[];
    instances?: Map<Type, unknown>;
  },
): ListenerHarness {
  const callbacks: Record<string, ListenerCallback[]> = {};
  const getCalls: unknown[][] = [];
  const resolutionCalls: unknown[][] = [];
  const exceptionCalls: unknown[][] = [];
  const loggerErrors: unknown[][] = [];
  const loggerWarnings: unknown[][] = [];
  const listens: Record<string, PromiseWithResolvers<void>[]> = {};
  const scopes: string[] = [];

  for (const [name, entry] of Object.entries(harnessOptions.entries)) {
    entry.kv ??= {
      listenQueue: (callback: ListenerCallback) => {
        const listen = Promise.withResolvers<void>();

        (callbacks[name] ??= []).push(callback);
        (listens[name] ??= []).push(listen);

        return listen.promise;
      },
    } as unknown as Kv;
  }

  const connections = {
    connections: new Map(Object.entries(harnessOptions.entries)),
    get: (name = "default") => {
      getCalls.push([KvConnections, name]);

      return harnessOptions.entries[name].kv;
    },
  } as unknown as KvConnections;
  const ctx = {
    runInRequestScopeAsync: async (
      contextId: string,
      callback: () => Promise<void>,
    ) => {
      scopes.push(contextId);

      return await callback();
    },
  } as InjectorContext;
  const moduleRef = {
    get: (token: unknown, options?: unknown) => {
      getCalls.push([token, options]);

      if (token === KvConnections) {
        return connections;
      }

      if (token === InjectorContext) {
        return ctx;
      }

      if (harnessOptions.instances?.has(token as Type)) {
        resolutionCalls.push([token, options]);

        return harnessOptions.instances.get(token as Type);
      }

      throw new Error("Unexpected token");
    },
    getTokensByTag: (tag: unknown) =>
      tag === QUEUE_HANDLER ? harnessOptions.handlers ?? [] : [],
  } as unknown as ModuleRef;
  const listener = new KvQueueListener(moduleRef);

  Object.defineProperty(listener, "exceptionHandler", {
    value: {
      handle: (err: unknown, host: unknown) => {
        exceptionCalls.push([err, host]);
      },
    } as unknown as ExceptionHandler,
  });
  Object.defineProperty(listener, "logger", {
    value: {
      error: (...args: unknown[]) => loggerErrors.push(args),
      warn: (...args: unknown[]) => loggerWarnings.push(args),
    },
  });

  return {
    callbacks,
    exceptionCalls,
    getCalls,
    listens,
    loggerErrors,
    loggerWarnings,
    listener,
    resolutionCalls,
    scopes,
  };
}

function settle(ms = 0): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();

  setTimeout(resolve, ms);

  return promise;
}

/**
 * Polls `key` for at most two seconds; `kv.watch` does not report the writes
 * of `keysIfUndelivered`.
 */
async function pollValue(kv: Kv, key: KvKey): Promise<unknown> {
  for (let poll = 0; poll < 200; poll++) {
    const { value } = await kv.get(key);

    if (value !== null) {
      return value;
    }

    await settle(10);
  }

  return null;
}

describe(KvQueueListener.name, () => {
  it("does nothing during bootstrap when no queue handlers exist", async () => {
    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
    });

    await harness.listener.onApplicationBootstrap();

    assertEquals(harness.callbacks, {});
    assertEquals(
      harness.getCalls.some(([token]) => token === InjectorContext),
      false,
    );
  });

  it("ignores handlers without a queue-enabled connection or metadata", async () => {
    @QueueHandler("missing")
    class MissingConnectionHandler {
      @Queued("missing")
      handle() {}
    }

    @QueueHandler("disabled")
    class DisabledQueueHandler {
      @Queued("disabled")
      handle() {}
    }

    @QueueHandler()
    class NoMessageMetadataHandler {}

    const harness = createHarness({
      entries: {
        default: { path: "/tmp/default.db", queue: true },
        disabled: { path: "/tmp/disabled.db", queue: false },
      },
      handlers: [
        MissingConnectionHandler,
        DisabledQueueHandler,
        NoMessageMetadataHandler,
      ],
    });

    await harness.listener.onApplicationBootstrap();

    assertEquals(harness.callbacks, {});
  });

  it("registers queue listeners for queue-enabled connections", async () => {
    @QueueHandler()
    class Handler {
      @Queued("event")
      handle() {}
    }

    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
      handlers: [Handler],
      instances: new Map([[Handler, new Handler()]]),
    });

    await harness.listener.onApplicationBootstrap();

    assertEquals(harness.callbacks.default.length, 1);
  });

  it("ignores invalid queue messages", async () => {
    const calls: unknown[][] = [];

    @QueueHandler()
    class Handler {
      @Queued("event")
      handle(payload?: object) {
        calls.push([payload]);
      }
    }

    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
      handlers: [Handler],
      instances: new Map([[Handler, new Handler()]]),
    });

    await harness.listener.onApplicationBootstrap();
    await harness.callbacks.default[0]({ payload: { ignored: true } });
    await harness.callbacks.default[0](null);

    assertEquals(calls, []);
    assertEquals(harness.scopes, []);
  });

  it("warns for unmatched queue messages", async () => {
    @QueueHandler()
    class Handler {
      @Queued("known")
      handle() {}
    }

    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
      handlers: [Handler],
      instances: new Map([[Handler, new Handler()]]),
    });

    await harness.listener.onApplicationBootstrap();
    await harness.callbacks.default[0]({ id: "unknown" });

    assertEquals(harness.loggerWarnings, [[
      "Received unhandled event unknown",
    ]]);
    assertEquals(harness.scopes, []);
  });

  it("dispatches string events in a request scope", async () => {
    const calls: unknown[][] = [];

    @QueueHandler()
    class Handler {
      @Queued("created")
      handle(payload?: object, match?: RegExpMatchArray) {
        calls.push([payload, match]);
      }
    }

    const instance = new Handler();
    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
      handlers: [Handler],
      instances: new Map([[Handler, instance]]),
    });

    await harness.listener.onApplicationBootstrap();
    await harness.callbacks.default[0]({ id: "created", payload: { id: 1 } });

    assertEquals(calls, [[{ id: 1 }, undefined]]);
    assertEquals(harness.scopes.length, 1);
    assertStrictEquals(harness.resolutionCalls[0][0], Handler);
    assertEquals(
      (harness.resolutionCalls[0][1] as { contextId: string }).contextId,
      harness.scopes[0],
    );
  });

  it("dispatches regexp events with match data and dto payload conversion", async () => {
    const calls: unknown[][] = [];

    @QueueHandler()
    class Handler {
      @Queued(/^user\.(\d+)$/, PayloadDto)
      handle(payload?: object, match?: RegExpMatchArray) {
        calls.push([payload, match]);
      }
    }

    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
      handlers: [Handler],
      instances: new Map([[Handler, new Handler()]]),
    });

    await harness.listener.onApplicationBootstrap();
    await harness.callbacks.default[0]({
      id: "user.42",
      payload: { value: 7 },
    });

    assertInstanceOf(calls[0][0], PayloadDto);
    assertEquals((calls[0][0] as PayloadDto).value, 7);
    assertEquals((calls[0][1] as RegExpMatchArray)[0], "user.42");
    assertEquals((calls[0][1] as RegExpMatchArray)[1], "42");
  });

  it("routes metadata with a named queue to that queue listener", async () => {
    const calls: unknown[][] = [];

    @QueueHandler()
    class Handler {
      @Queued({ event: "email.created", name: "emails" })
      handle(payload?: object) {
        calls.push([payload]);
      }
    }

    const harness = createHarness({
      entries: {
        default: { path: "/tmp/default.db", queue: true },
        emails: { path: "/tmp/emails.db", queue: true },
      },
      handlers: [Handler],
      instances: new Map([[Handler, new Handler()]]),
    });

    await harness.listener.onApplicationBootstrap();

    assertEquals(harness.callbacks.default, undefined);
    assertEquals(harness.callbacks.emails.length, 1);

    await harness.callbacks.emails[0]({
      id: "email.created",
      payload: { email: "a@example.com" },
    });

    assertEquals(calls, [[{ email: "a@example.com" }]]);
  });

  it("passes undefined payload through even when dto metadata exists", async () => {
    const calls: unknown[][] = [];

    @QueueHandler()
    class Handler {
      @Queued("empty", PayloadDto)
      handle(payload?: object) {
        calls.push([payload]);
      }
    }

    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
      handlers: [Handler],
      instances: new Map([[Handler, new Handler()]]),
    });

    await harness.listener.onApplicationBootstrap();
    await harness.callbacks.default[0]({ id: "empty" });

    assertEquals(calls, [[undefined]]);
  });

  it("reports handler errors and rethrows them so the store redelivers the message", async () => {
    const failure = new Error("handler failed");

    @QueueHandler()
    class Handler {
      @Queued("failing")
      handle() {
        throw failure;
      }
    }

    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
      handlers: [Handler],
      instances: new Map([[Handler, new Handler()]]),
    });

    await harness.listener.onApplicationBootstrap();

    const error = await assertRejects(async () => {
      await harness.callbacks.default[0]({ id: "failing", payload: { x: 1 } });
    });

    assertStrictEquals(error, failure);
    assertEquals(harness.exceptionCalls.length, 1);
    assertStrictEquals(harness.exceptionCalls[0][0], failure);
    assertInstanceOf(harness.exceptionCalls[0][1], RpcHostArguments);
    assertEquals(
      (harness.exceptionCalls[0][1] as RpcHostArguments).switchToRpc()
        .getPattern(),
      "failing",
    );
  });

  it("acknowledges a ForbiddenException thrown by the handler", async () => {
    @QueueHandler()
    class Handler {
      @Queued("forbidden")
      handle() {
        throw new ForbiddenException();
      }
    }

    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
      handlers: [Handler],
      instances: new Map([[Handler, new Handler()]]),
    });

    await harness.listener.onApplicationBootstrap();
    await harness.callbacks.default[0]({ id: "forbidden" });

    assertEquals(harness.exceptionCalls.length, 1);
    assertInstanceOf(harness.exceptionCalls[0][0], ForbiddenException);
  });

  it("reports and rethrows errors of the dto conversion", async () => {
    const failure = new Error("invalid payload");
    const calls: unknown[] = [];

    class StrictDto {
      constructor() {
        throw failure;
      }
    }

    @QueueHandler()
    class Handler {
      @Queued("strict", StrictDto)
      handle(payload?: object) {
        calls.push(payload);
      }
    }

    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
      handlers: [Handler],
      instances: new Map([[Handler, new Handler()]]),
    });

    await harness.listener.onApplicationBootstrap();

    const error = await assertRejects(async () => {
      await harness.callbacks.default[0]({ id: "strict", payload: { x: 1 } });
    });

    assertStrictEquals(error, failure);
    assertEquals(calls, []);
    assertEquals(harness.exceptionCalls.length, 1);
    assertStrictEquals(harness.exceptionCalls[0][0], failure);
    assertEquals(
      (harness.exceptionCalls[0][1] as RpcHostArguments).switchToRpc()
        .getPattern(),
      "strict",
    );
  });

  it("passes the match of global and sticky patterns for every message", async () => {
    const matches: unknown[] = [];

    @QueueHandler()
    class Handler {
      @Queued(/^user\.(\w+)$/g)
      onUser(_payload?: object, match?: RegExpMatchArray) {
        matches.push(match?.[1]);
      }

      @Queued(/order\.(\w+)/y)
      onOrder(_payload?: object, match?: RegExpMatchArray) {
        matches.push(match?.[1]);
      }
    }

    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
      handlers: [Handler],
      instances: new Map([[Handler, new Handler()]]),
    });

    await harness.listener.onApplicationBootstrap();

    for (const id of ["user.created", "user.deleted", "order.paid"]) {
      await harness.callbacks.default[0]({ id });
    }

    assertEquals(matches, ["created", "deleted", "paid"]);
  });

  it("binds each queued method to its own queue-enabled connection", async () => {
    const calls: string[] = [];

    @QueueHandler("jobs")
    class JobsHandler {
      @Queued("ping", "default")
      onPing() {
        calls.push("ping");
      }

      @Queued("pong")
      onPong() {
        calls.push("pong");
      }
    }

    @QueueHandler()
    class DefaultHandler {
      @Queued("job", "jobs")
      onJob() {
        calls.push("job");
      }

      @Queued("typo", "missing")
      onTypo() {
        calls.push("typo");
      }
    }

    const harness = createHarness({
      entries: {
        default: { path: "/tmp/default.db", queue: true },
        jobs: { path: "/tmp/jobs.db" },
      },
      handlers: [JobsHandler, DefaultHandler],
      instances: new Map<Type, unknown>([
        [JobsHandler, new JobsHandler()],
        [DefaultHandler, new DefaultHandler()],
      ]),
    });

    await harness.listener.onApplicationBootstrap();

    assertEquals(Object.keys(harness.callbacks), ["default"]);
    assertEquals(harness.callbacks.default.length, 1);

    for (const id of ["ping", "pong", "job", "typo"]) {
      await harness.callbacks.default[0]({ id });
    }

    assertEquals(calls, ["ping"]);
    assertEquals(harness.loggerWarnings, [
      ["Received unhandled event pong"],
      ["Received unhandled event job"],
      ["Received unhandled event typo"],
    ]);
  });

  describe("shutdown", () => {
    @QueueHandler()
    class SlowHandler {
      public readonly calls: string[] = [];
      public readonly release: PromiseWithResolvers<void> = Promise
        .withResolvers<void>();

      @Queued("slow")
      handle(): Promise<void> {
        this.calls.push("slow");

        return this.release.promise;
      }
    }

    async function bootstrap(
      handler: SlowHandler,
    ): Promise<ListenerHarness> {
      const harness = createHarness({
        entries: { default: { path: "/tmp/default.db", queue: true } },
        handlers: [SlowHandler],
        instances: new Map([[SlowHandler, handler]]),
      });

      await harness.listener.onApplicationBootstrap();

      return harness;
    }

    it("waits for running handlers before shutdown continues", async () => {
      const handler = new SlowHandler();
      const harness = await bootstrap(handler);
      const delivery = harness.callbacks.default[0]({ id: "slow" });
      let stopped = false;
      const shutdown = harness.listener.onBeforeApplicationShutdown("SIGTERM")
        .then(() => {
          stopped = true;
        });

      await settle();
      assertEquals(stopped, false);

      handler.release.resolve();
      await delivery;
      await shutdown;

      assertEquals(stopped, true);
      assertEquals(handler.calls, ["slow"]);
    });

    it("leaves messages delivered after shutdown started unacknowledged", async () => {
      const handler = new SlowHandler();
      const harness = await bootstrap(handler);
      let settled = false;

      await harness.listener.onBeforeApplicationShutdown("SIGTERM");

      Promise.resolve(harness.callbacks.default[0]({ id: "slow" })).finally(
        () => {
          settled = true;
        },
      );
      await settle();

      assertEquals(settled, false);
      assertEquals(handler.calls, []);
      assertEquals(harness.scopes, []);
    });
  });

  describe("queue subscription failures", () => {
    // Deno's test runner fails a test on unhandled promise rejections, so each
    // case also proves that the listenQueue rejection is handled.
    @QueueHandler("jobs")
    class JobsHandler {
      @Queued("event")
      handle() {}
    }

    async function bootstrap(): Promise<ListenerHarness> {
      const harness = createHarness({
        entries: { jobs: { path: "/tmp/jobs.db", queue: true } },
        handlers: [JobsHandler],
        instances: new Map([[JobsHandler, new JobsHandler()]]),
      });

      await harness.listener.onApplicationBootstrap();

      return harness;
    }

    it("logs an Error rejection with the queue name and stack", async () => {
      const harness = await bootstrap();
      const failure = new Error("message not found");

      harness.listens.jobs[0].reject(failure);
      await settle();

      assertEquals(harness.loggerErrors, [[
        'Queue listener for "jobs" failed: message not found',
        failure.stack,
      ]]);
    });

    it("logs a non-Error rejection without a stack", async () => {
      const harness = await bootstrap();

      harness.listens.jobs[0].reject("boom");
      await settle();

      assertEquals(harness.loggerErrors, [[
        'Queue listener for "jobs" failed: boom',
      ]]);
    });

    it("ignores a rejection caused by closing the store during shutdown", async () => {
      const harness = await bootstrap();

      await harness.listener.onBeforeApplicationShutdown("SIGTERM");
      harness.listens.jobs[0].reject(new Error("message not found"));
      await settle();

      assertEquals(harness.loggerErrors, []);
    });
  });

  describe("guard enforcement", () => {
    it("calls handler when class-level guard allows", async () => {
      const calls: unknown[] = [];

      @UseGuards(() => true)
      @QueueHandler()
      class Handler {
        @Queued("guarded.allow")
        handle(payload?: object) {
          calls.push(payload);
        }
      }

      const harness = createHarness({
        entries: { default: { path: "/tmp/default.db", queue: true } },
        handlers: [Handler],
        instances: new Map([[Handler, new Handler()]]),
      });

      await harness.listener.onApplicationBootstrap();
      await harness.callbacks.default[0]({ id: "guarded.allow" });

      assertEquals(calls.length, 1);
      assertEquals(harness.exceptionCalls.length, 0);
    });

    it("passes ForbiddenException to exception handler when class-level guard denies", async () => {
      @UseGuards(() => false)
      @QueueHandler()
      class Handler {
        @Queued("guarded.block")
        handle() {}
      }

      const harness = createHarness({
        entries: { default: { path: "/tmp/default.db", queue: true } },
        handlers: [Handler],
        instances: new Map([[Handler, new Handler()]]),
      });

      await harness.listener.onApplicationBootstrap();
      await harness.callbacks.default[0]({ id: "guarded.block" });

      assertEquals(harness.exceptionCalls.length, 1);
      assertInstanceOf(harness.exceptionCalls[0][0], ForbiddenException);
    });

    it("calls handler when method-level guard allows", async () => {
      const calls: unknown[] = [];

      @QueueHandler()
      class Handler {
        @UseGuards(() => true)
        @Queued("method.allow")
        handle(payload?: object) {
          calls.push(payload);
        }
      }

      const harness = createHarness({
        entries: { default: { path: "/tmp/default.db", queue: true } },
        handlers: [Handler],
        instances: new Map([[Handler, new Handler()]]),
      });

      await harness.listener.onApplicationBootstrap();
      await harness.callbacks.default[0]({ id: "method.allow" });

      assertEquals(calls.length, 1);
      assertEquals(harness.exceptionCalls.length, 0);
    });

    it("passes ForbiddenException to exception handler when method-level guard denies", async () => {
      @QueueHandler()
      class Handler {
        @UseGuards(() => false)
        @Queued("method.block")
        handle() {}
      }

      const harness = createHarness({
        entries: { default: { path: "/tmp/default.db", queue: true } },
        handlers: [Handler],
        instances: new Map([[Handler, new Handler()]]),
      });

      await harness.listener.onApplicationBootstrap();
      await harness.callbacks.default[0]({ id: "method.block" });

      assertEquals(harness.exceptionCalls.length, 1);
      assertInstanceOf(harness.exceptionCalls[0][0], ForbiddenException);
    });

    it("calls canActivate on an instantiated guard object", async () => {
      const calls: unknown[] = [];
      const guardContexts: ExecutionContext[] = [];
      const guard: CanActivate = {
        canActivate: (ctx) => {
          guardContexts.push(ctx);

          return true;
        },
      };

      @UseGuards(guard)
      @QueueHandler()
      class Handler {
        @Queued("instance.allow")
        handle(payload?: object) {
          calls.push(payload);
        }
      }

      const harness = createHarness({
        entries: { default: { path: "/tmp/default.db", queue: true } },
        handlers: [Handler],
        instances: new Map([[Handler, new Handler()]]),
      });

      await harness.listener.onApplicationBootstrap();
      await harness.callbacks.default[0]({
        id: "instance.allow",
        payload: { x: 1 },
      });

      assertEquals(calls, [{ x: 1 }]);
      assertEquals(guardContexts.length, 1);
      assertStrictEquals(guardContexts[0].getClass(), Handler as unknown);
      assertEquals(harness.exceptionCalls.length, 0);
    });

    it("resolves a guard class via DI and allows when canActivate returns true", async () => {
      const calls: unknown[] = [];

      class AllowGuard implements CanActivate {
        canActivate(_ctx: ExecutionContext): boolean {
          return true;
        }
      }

      @UseGuards(AllowGuard)
      @QueueHandler()
      class Handler {
        @Queued("di.allow")
        handle(payload?: object) {
          calls.push(payload);
        }
      }

      const guardInstance = new AllowGuard();

      const harness = createHarness({
        entries: { default: { path: "/tmp/default.db", queue: true } },
        handlers: [Handler],
        instances: new Map<Type, unknown>([
          [Handler, new Handler()],
          [AllowGuard as unknown as Type, guardInstance],
        ]),
      });

      await harness.listener.onApplicationBootstrap();
      await harness.callbacks.default[0]({ id: "di.allow" });

      assertEquals(calls.length, 1);
      assertEquals(harness.exceptionCalls.length, 0);
    });

    it("resolves a guard class via DI and blocks when canActivate returns false", async () => {
      class BlockGuard implements CanActivate {
        canActivate(_ctx: ExecutionContext): boolean {
          return false;
        }
      }

      @UseGuards(BlockGuard)
      @QueueHandler()
      class Handler {
        @Queued("di.block")
        handle() {}
      }

      const guardInstance = new BlockGuard();

      const harness = createHarness({
        entries: { default: { path: "/tmp/default.db", queue: true } },
        handlers: [Handler],
        instances: new Map<Type, unknown>([
          [Handler, new Handler()],
          [BlockGuard as unknown as Type, guardInstance],
        ]),
      });

      await harness.listener.onApplicationBootstrap();
      await harness.callbacks.default[0]({ id: "di.block" });

      assertEquals(harness.exceptionCalls.length, 1);
      assertInstanceOf(harness.exceptionCalls[0][0], ForbiddenException);
    });

    it("short-circuits on first failing guard", async () => {
      let secondGuardCalled = false;

      @UseGuards(() => false, () => {
        secondGuardCalled = true;
        return true;
      })
      @QueueHandler()
      class Handler {
        @Queued("shortcircuit")
        handle() {}
      }

      const harness = createHarness({
        entries: { default: { path: "/tmp/default.db", queue: true } },
        handlers: [Handler],
        instances: new Map([[Handler, new Handler()]]),
      });

      await harness.listener.onApplicationBootstrap();
      await harness.callbacks.default[0]({ id: "shortcircuit" });

      assertInstanceOf(harness.exceptionCalls[0][0], ForbiddenException);
      assertEquals(secondGuardCalled, false);
    });

    it("passes RpcHostArguments with correct pattern when guard denies", async () => {
      @UseGuards(() => false)
      @QueueHandler()
      class Handler {
        @Queued("guard.host.check")
        handle() {}
      }

      const harness = createHarness({
        entries: { default: { path: "/tmp/default.db", queue: true } },
        handlers: [Handler],
        instances: new Map([[Handler, new Handler()]]),
      });

      await harness.listener.onApplicationBootstrap();
      await harness.callbacks.default[0]({
        id: "guard.host.check",
        payload: { x: 1 },
      });

      assertInstanceOf(harness.exceptionCalls[0][1], RpcHostArguments);
      assertEquals(
        (harness.exceptionCalls[0][1] as RpcHostArguments).switchToRpc()
          .getPattern(),
        "guard.host.check",
      );
    });
  });

  describe("in a compiled application", () => {
    async function compile(providers: Type[]): Promise<TestingModule> {
      const module = await Test.createTestingModule({
        imports: [
          KvModule.forRoot({ connection: { path: ":memory:", queue: true } }),
        ],
        providers,
      })
        .useCoreGlobals()
        .compile();

      await module.init();

      return module;
    }

    it("resolves class guards provided outside of KvModule", async () => {
      const delivered = Promise.withResolvers<unknown>();
      const patterns: string[] = [];

      @Injectable()
      class AllowGuard implements CanActivate {
        canActivate(ctx: ExecutionContext): boolean {
          patterns.push(ctx.switchToRpc().getPattern() as string);

          return true;
        }
      }

      @UseGuards(AllowGuard)
      @QueueHandler()
      class GuardedHandler {
        @Queued("ping")
        handle(payload?: object): void {
          delivered.resolve(payload);
        }
      }

      const module = await compile([AllowGuard, GuardedHandler]);
      const exceptionHandler = await module.get(ExceptionHandler);
      const handle = stub(exceptionHandler, "handle", (err: unknown) => {
        delivered.reject(err);

        return Promise.resolve();
      });

      try {
        await (await module.get(KvQueue)).send({
          id: "ping",
          payload: { n: 1 },
        });

        assertEquals(await delivered.promise, { n: 1 });
        assertEquals(patterns, ["ping"]);
      } finally {
        handle.restore();
        await module.close();
      }
    });

    it("lets the store retry a failing message and dead-letter it", async () => {
      const attempts: unknown[] = [];

      @QueueHandler()
      class FailingHandler {
        @Queued("job")
        handle(payload?: object): void {
          attempts.push(payload);

          throw new Error("job failed");
        }
      }

      const module = await compile([FailingHandler]);
      const exceptionHandler = await module.get(ExceptionHandler);
      const handle = stub(exceptionHandler, "handle", () => Promise.resolve());

      try {
        await (await module.get(KvQueue)).send({
          id: "job",
          payload: { n: 1 },
          options: {
            backoffSchedule: [1, 1],
            keysIfUndelivered: [["failed", "job"]],
          },
        });

        const kv = (await module.get(KvConnections)).get();

        assertEquals(await pollValue(kv, ["failed", "job"]), {
          id: "job",
          payload: { n: 1 },
        });
        assertEquals(attempts, [{ n: 1 }, { n: 1 }, { n: 1 }]);
        assertEquals(handle.calls.length, 3);
      } finally {
        handle.restore();
        await module.close();
      }
    });
  });
});
