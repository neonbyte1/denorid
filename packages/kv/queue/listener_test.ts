import type {
  CanActivate,
  ExceptionHandler,
  ExecutionContext,
} from "@denorid/core";
import { ForbiddenException, RcpHostArguments, UseGuards } from "@denorid/core";
import { InjectorContext, type ModuleRef, type Type } from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { QUEUE_HANDLER } from "../_constants.ts";
import type { ConnectionEntry } from "../_connections.ts";
import { KvConnections } from "../connections.ts";
import { Queued, QueueHandler } from "./decorator.ts";
import { KvQueueListener } from "./listener.ts";

type ListenerCallback = (msg: unknown) => void | Promise<void>;

interface ListenerHarness {
  callbacks: Record<string, ListenerCallback[]>;
  closeCalls: string[];
  exceptionCalls: unknown[][];
  getCalls: unknown[][];
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
  const loggerWarnings: unknown[][] = [];
  const scopes: string[] = [];
  const closeCalls: string[] = [];

  for (const [name, entry] of Object.entries(harnessOptions.entries)) {
    entry.kv ??= {
      listenQueue: (callback: ListenerCallback) => {
        (callbacks[name] ??= []).push(callback);
      },
    } as unknown as Deno.Kv;
  }

  const connections = {
    connections: new Map(Object.entries(harnessOptions.entries)),
    get: (name = "default") => {
      getCalls.push([KvConnections, name]);

      return harnessOptions.entries[name].kv;
    },
    close: () => {
      closeCalls.push("close");
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
      warn: (...args: unknown[]) => loggerWarnings.push(args),
    },
  });

  return {
    callbacks,
    closeCalls,
    exceptionCalls,
    getCalls,
    loggerWarnings,
    listener,
    resolutionCalls,
    scopes,
  };
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

  it("delegates handler errors to the exception handler with RcpHostArguments", async () => {
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
    await harness.callbacks.default[0]({ id: "failing", payload: { x: 1 } });

    assertEquals(harness.exceptionCalls.length, 1);
    assertStrictEquals(harness.exceptionCalls[0][0], failure);
    assertInstanceOf(harness.exceptionCalls[0][1], RcpHostArguments);
    assertEquals(
      (harness.exceptionCalls[0][1] as RcpHostArguments).switchToRpc()
        .getPattern(),
      "failing",
    );
  });

  it("closes kv connections before application shutdown", async () => {
    const harness = createHarness({
      entries: { default: { path: "/tmp/default.db", queue: true } },
    });

    await harness.listener.onBeforeApplicationShutdown("SIGTERM");

    assertEquals(harness.closeCalls, ["close"]);
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

    it("passes RcpHostArguments with correct pattern when guard denies", async () => {
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

      assertInstanceOf(harness.exceptionCalls[0][1], RcpHostArguments);
      assertEquals(
        (harness.exceptionCalls[0][1] as RcpHostArguments).switchToRpc()
          .getPattern(),
        "guard.host.check",
      );
    });
  });
});
