import type {
  CanActivate,
  ExceptionHandler,
  ExecutionContext,
  HostArguments,
} from "@denorid/core";
import { ForbiddenException, UseGuards } from "@denorid/core";
import {
  EventPattern,
  MessageController,
  MessagePattern,
  serializePattern,
} from "@denorid/core/microservices";
import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals, assertRejects } from "@std/assert";
import { beforeEach, describe, it } from "@std/testing/bdd";
import { spy } from "@std/testing/mock";
import { Server } from "./server.ts";

function makeCtx(...pairs: [Type, unknown][]): InjectorContext {
  const map = new Map<Type, unknown>(pairs);
  return {
    runInRequestScopeAsync: (_id: string, fn: () => Promise<unknown>) => fn(),
    getHostModuleRef: () => ({
      get: (type: Type, _opts: unknown) => Promise.resolve(map.get(type)),
    }),
    clearContext: () => {},
  } as unknown as InjectorContext;
}

describe(Server.name, () => {
  class ConcreteServer extends Server {
    public override async listen(): Promise<void> {
      await Promise.resolve();
    }
    public override async close(): Promise<void> {
      await Promise.resolve();
    }
    public dispatchPublic(pattern: string, data: unknown): Promise<unknown> {
      return this.dispatch(pattern, data);
    }
  }

  let server: ConcreteServer;

  beforeEach(() => {
    server = new ConcreteServer({});
  });

  describe("setExceptionHandler", () => {
    it("stores the exception handler", () => {
      const handler = {} as ExceptionHandler;

      server.setExceptionHandler(handler);
      assertEquals(
        (server as unknown as Record<string, unknown>)["exceptionHandler"],
        handler,
      );
    });
  });

  describe("registerHandlers", () => {
    it("registers handlers from decorated controller types", () => {
      @MessageController()
      class TestCtrl {
        @MessagePattern("ping")
        ping(): string {
          return "pong";
        }
      }

      const instance = new TestCtrl();
      server.registerHandlers(
        [TestCtrl as unknown as Type],
        makeCtx([TestCtrl as unknown as Type, instance]),
      );

      assertEquals(server["handlers"].has(serializePattern("ping")), true);
    });

    it("registers event patterns", () => {
      @MessageController()
      class EvCtrl {
        @EventPattern("evt.fired")
        onEvent(): void {}
      }

      server.registerHandlers(
        [EvCtrl as unknown as Type],
        makeCtx([EvCtrl as unknown as Type, new EvCtrl()]),
      );

      const key = serializePattern("evt.fired");
      assertEquals(server["handlers"].get(key)?.type, "event");
    });

    it("skips types with no message mapping metadata", () => {
      class Plain {}
      server.registerHandlers(
        [Plain as unknown as Type],
        makeCtx([Plain as unknown as Type, new Plain()]),
      );
      assertEquals(server["handlers"].size, 0);
    });

    it("registers multiple handlers from multiple types", () => {
      @MessageController()
      class CtrlA {
        @MessagePattern("a")
        handle(): string {
          return "a";
        }
      }

      @MessageController()
      class CtrlB {
        @MessagePattern("b")
        handle(): string {
          return "b";
        }
      }

      server.registerHandlers(
        [CtrlA as unknown as Type, CtrlB as unknown as Type],
        makeCtx(
          [CtrlA as unknown as Type, new CtrlA()],
          [CtrlB as unknown as Type, new CtrlB()],
        ),
      );

      assertEquals(server["handlers"].size, 2);
    });
  });

  describe("dispatch", () => {
    it("throws when no handler is registered for the pattern", async () => {
      await assertRejects(
        () => server.dispatchPublic("unknown", {}),
        Error,
        'No handler registered for pattern "unknown"',
      );
    });

    it("throws when the registered method is not a function", async () => {
      class BadCls {}
      server["handlers"].set("bad", {
        methodName: "method",
        type: "message",
        controllerType: BadCls as unknown as Type,
        controllerGuards: [],
        methodGuards: [],
      });
      server["ctx"] = makeCtx([BadCls as unknown as Type, {
        method: "not-a-function",
      }]);

      await assertRejects(
        () => server.dispatchPublic("bad", {}),
        Error,
        'Handler "method" is not a function',
      );
    });

    it("calls the handler and returns its result", async () => {
      @MessageController()
      class Ctrl {
        @MessagePattern("hello")
        greet(data: unknown): string {
          return `hi ${data}`;
        }
      }

      server.registerHandlers(
        [Ctrl as unknown as Type],
        makeCtx([Ctrl as unknown as Type, new Ctrl()]),
      );

      const result = await server.dispatchPublic(
        serializePattern("hello"),
        "world",
      );
      assertEquals(result, "hi world");
    });

    it("calls exceptionHandler.handle when handler throws and exceptionHandler is set", async () => {
      @MessageController()
      class ErrCtrl {
        @MessagePattern("err")
        fail(): never {
          throw new Error("boom");
        }
      }

      server.registerHandlers(
        [ErrCtrl as unknown as Type],
        makeCtx([ErrCtrl as unknown as Type, new ErrCtrl()]),
      );

      const handled: unknown[] = [];
      const mockHandler: ExceptionHandler = {
        handle: (err: unknown, _host: HostArguments) => {
          handled.push(err);

          return Promise.resolve(undefined);
        },
        register: async () => {},
        canHandle: () => true,
      } as unknown as ExceptionHandler;

      server.setExceptionHandler(mockHandler);

      await assertRejects(
        () => server.dispatchPublic(serializePattern("err"), null),
        Error,
        "boom",
      );

      assertEquals(handled.length, 1);
    });

    it("logs error when no exceptionHandler is set and handler throws", async () => {
      @MessageController()
      class ErrCtrl2 {
        @MessagePattern("err2")
        fail(): never {
          throw new Error("no-handler-boom");
        }
      }

      server.registerHandlers(
        [ErrCtrl2 as unknown as Type],
        makeCtx([ErrCtrl2 as unknown as Type, new ErrCtrl2()]),
      );

      const errorSpy = spy(
        (server as unknown as Record<
          string,
          { error: (msg: string, err: unknown) => void }
        >)["logger"],
        "error",
      );

      await assertRejects(
        () => server.dispatchPublic(serializePattern("err2"), null),
        Error,
        "no-handler-boom",
      );

      assertEquals(errorSpy.calls.length, 1);
    });

    it("propagates error from clearContext when it throws in finally", async () => {
      @MessageController()
      class ClearCtrl {
        @MessagePattern("clear.throw")
        handle(): string {
          return "ok";
        }
      }

      const clearError = new Error("clear-threw");
      server["handlers"].set(serializePattern("clear.throw"), {
        methodName: "handle",
        type: "message",
        controllerType: ClearCtrl as unknown as Type,
        controllerGuards: [],
        methodGuards: [],
      });
      server["ctx"] = {
        runInRequestScopeAsync: (_id: string, fn: () => Promise<unknown>) =>
          fn(),
        getHostModuleRef: () => ({
          get: (_type: Type, _opts: unknown) =>
            Promise.resolve(new ClearCtrl()),
        }),
        clearContext: () => {
          throw clearError;
        },
      } as unknown as InjectorContext;

      await assertRejects(
        () => server.dispatchPublic(serializePattern("clear.throw"), null),
        Error,
        "clear-threw",
      );
    });

    it("propagates error from exceptionHandler.handle when it throws", async () => {
      @MessageController()
      class ErrCtrl3 {
        @MessagePattern("err3")
        fail(): never {
          throw new Error("original");
        }
      }

      server.registerHandlers(
        [ErrCtrl3 as unknown as Type],
        makeCtx([ErrCtrl3 as unknown as Type, new ErrCtrl3()]),
      );

      const handlerError = new Error("handler-threw");
      const mockHandler: ExceptionHandler = {
        handle: () => Promise.reject(handlerError),
        register: async () => {},
        canHandle: () => true,
      } as unknown as ExceptionHandler;

      server.setExceptionHandler(mockHandler);

      await assertRejects(
        () => server.dispatchPublic(serializePattern("err3"), null),
        Error,
        "handler-threw",
      );
    });
  });

  describe("setGlobalGuards", () => {
    it("stores the provided guards", () => {
      const guard = () => true;
      server.setGlobalGuards([guard]);

      assertEquals(
        (server as unknown as Record<string, unknown>)["globalGuards"],
        [guard],
      );
    });

    it("replaces previously stored guards", () => {
      const guardA = () => true;
      const guardB = () => false;
      server.setGlobalGuards([guardA]);
      server.setGlobalGuards([guardB]);

      assertEquals(
        (server as unknown as Record<string, unknown>)["globalGuards"],
        [guardB],
      );
    });
  });

  describe("dispatch - guard enforcement", () => {
    it("allows dispatch when function guard returns true", async () => {
      @MessageController()
      class GuardedCtrl {
        @MessagePattern("guarded.allow")
        handle(): string {
          return "ok";
        }
      }

      server.registerHandlers(
        [GuardedCtrl as unknown as Type],
        makeCtx([GuardedCtrl as unknown as Type, new GuardedCtrl()]),
      );
      server.setGlobalGuards([() => true]);

      const result = await server.dispatchPublic(
        serializePattern("guarded.allow"),
        null,
      );
      assertEquals(result, "ok");
    });

    it("throws ForbiddenException when function guard returns false", async () => {
      @MessageController()
      class BlockedCtrl {
        @MessagePattern("guarded.block")
        handle(): string {
          return "never";
        }
      }

      server.registerHandlers(
        [BlockedCtrl as unknown as Type],
        makeCtx([BlockedCtrl as unknown as Type, new BlockedCtrl()]),
      );
      server.setGlobalGuards([() => false]);

      await assertRejects(
        () => server.dispatchPublic(serializePattern("guarded.block"), null),
        ForbiddenException,
      );
    });

    it("allows dispatch when CanActivate guard returns true", async () => {
      @MessageController()
      class CtrlOk {
        @MessagePattern("guard.object.allow")
        handle(): string {
          return "allowed";
        }
      }

      server.registerHandlers(
        [CtrlOk as unknown as Type],
        makeCtx([CtrlOk as unknown as Type, new CtrlOk()]),
      );
      server.setGlobalGuards([{ canActivate: () => true }]);

      const result = await server.dispatchPublic(
        serializePattern("guard.object.allow"),
        null,
      );
      assertEquals(result, "allowed");
    });

    it("throws ForbiddenException when CanActivate guard returns false", async () => {
      @MessageController()
      class CtrlBlocked {
        @MessagePattern("guard.object.block")
        handle(): string {
          return "never";
        }
      }

      server.registerHandlers(
        [CtrlBlocked as unknown as Type],
        makeCtx([CtrlBlocked as unknown as Type, new CtrlBlocked()]),
      );
      server.setGlobalGuards([{ canActivate: () => false }]);

      await assertRejects(
        () =>
          server.dispatchPublic(serializePattern("guard.object.block"), null),
        ForbiddenException,
      );
    });

    it("short-circuits on first failing guard", async () => {
      @MessageController()
      class MultiGuardCtrl {
        @MessagePattern("multi.guard")
        handle(): string {
          return "ok";
        }
      }

      server.registerHandlers(
        [MultiGuardCtrl as unknown as Type],
        makeCtx([MultiGuardCtrl as unknown as Type, new MultiGuardCtrl()]),
      );

      let secondGuardCalled = false;
      server.setGlobalGuards([
        () => false,
        () => {
          secondGuardCalled = true;
          return true;
        },
      ]);

      await assertRejects(
        () => server.dispatchPublic(serializePattern("multi.guard"), null),
        ForbiddenException,
      );

      assertEquals(secondGuardCalled, false);
    });
  });

  describe("dispatch - controller guard enforcement", () => {
    it("allows dispatch when class-level guard returns true", async () => {
      @UseGuards(() => true)
      @MessageController()
      class GuardedCtrl {
        @MessagePattern("ctrl.guard.allow")
        handle(): string {
          return "ctrl-ok";
        }
      }

      server.registerHandlers(
        [GuardedCtrl as unknown as Type],
        makeCtx([GuardedCtrl as unknown as Type, new GuardedCtrl()]),
      );

      const result = await server.dispatchPublic(
        serializePattern("ctrl.guard.allow"),
        null,
      );
      assertEquals(result, "ctrl-ok");
    });

    it("throws ForbiddenException when class-level guard returns false", async () => {
      @UseGuards(() => false)
      @MessageController()
      class BlockedCtrl {
        @MessagePattern("ctrl.guard.block")
        handle(): string {
          return "never";
        }
      }

      server.registerHandlers(
        [BlockedCtrl as unknown as Type],
        makeCtx([BlockedCtrl as unknown as Type, new BlockedCtrl()]),
      );

      await assertRejects(
        () => server.dispatchPublic(serializePattern("ctrl.guard.block"), null),
        ForbiddenException,
      );
    });

    it("resolves a guard class via DI and allows when canActivate returns true", async () => {
      class AllowGuard implements CanActivate {
        canActivate(_ctx: ExecutionContext): boolean {
          return true;
        }
      }

      @UseGuards(AllowGuard)
      @MessageController()
      class DiGuardCtrl {
        @MessagePattern("ctrl.di.allow")
        handle(): string {
          return "di-ok";
        }
      }

      const guardInstance = new AllowGuard();

      server.registerHandlers(
        [DiGuardCtrl as unknown as Type],
        makeCtx(
          [DiGuardCtrl as unknown as Type, new DiGuardCtrl()],
          [AllowGuard as unknown as Type, guardInstance],
        ),
      );

      const result = await server.dispatchPublic(
        serializePattern("ctrl.di.allow"),
        null,
      );
      assertEquals(result, "di-ok");
    });

    it("resolves a guard class via DI and blocks when canActivate returns false", async () => {
      class BlockGuard implements CanActivate {
        canActivate(_ctx: ExecutionContext): boolean {
          return false;
        }
      }

      @UseGuards(BlockGuard)
      @MessageController()
      class DiGuardBlockCtrl {
        @MessagePattern("ctrl.di.block")
        handle(): string {
          return "never";
        }
      }

      const guardInstance = new BlockGuard();

      server.registerHandlers(
        [DiGuardBlockCtrl as unknown as Type],
        makeCtx(
          [DiGuardBlockCtrl as unknown as Type, new DiGuardBlockCtrl()],
          [BlockGuard as unknown as Type, guardInstance],
        ),
      );

      await assertRejects(
        () => server.dispatchPublic(serializePattern("ctrl.di.block"), null),
        ForbiddenException,
      );
    });
  });

  describe("dispatch - method guard enforcement", () => {
    it("allows dispatch when method-level guard returns true", async () => {
      @MessageController()
      class MethodGuardCtrl {
        @UseGuards(() => true)
        @MessagePattern("method.guard.allow")
        handle(): string {
          return "method-ok";
        }
      }

      server.registerHandlers(
        [MethodGuardCtrl as unknown as Type],
        makeCtx([MethodGuardCtrl as unknown as Type, new MethodGuardCtrl()]),
      );

      const result = await server.dispatchPublic(
        serializePattern("method.guard.allow"),
        null,
      );
      assertEquals(result, "method-ok");
    });

    it("throws ForbiddenException when method-level guard returns false", async () => {
      @MessageController()
      class MethodBlockCtrl {
        @UseGuards(() => false)
        @MessagePattern("method.guard.block")
        handle(): string {
          return "never";
        }
      }

      server.registerHandlers(
        [MethodBlockCtrl as unknown as Type],
        makeCtx([MethodBlockCtrl as unknown as Type, new MethodBlockCtrl()]),
      );

      await assertRejects(
        () =>
          server.dispatchPublic(serializePattern("method.guard.block"), null),
        ForbiddenException,
      );
    });
  });

  describe("dispatch - guard priority", () => {
    it("evaluates global, then controller, then method guards in order", async () => {
      const order: string[] = [];

      @UseGuards(() => {
        order.push("ctrl");
        return true;
      })
      @MessageController()
      class OrderCtrl {
        @UseGuards(() => {
          order.push("method");
          return true;
        })
        @MessagePattern("guard.order")
        handle(): string {
          return "ordered";
        }
      }

      server.registerHandlers(
        [OrderCtrl as unknown as Type],
        makeCtx([OrderCtrl as unknown as Type, new OrderCtrl()]),
      );
      server.setGlobalGuards([() => {
        order.push("global");
        return true;
      }]);

      await server.dispatchPublic(serializePattern("guard.order"), null);

      assertEquals(order, ["global", "ctrl", "method"]);
    });

    it("short-circuits on first failing controller guard before method guard", async () => {
      const methodGuardCalls: number[] = [];

      @UseGuards(() => false)
      @MessageController()
      class ShortCtrl {
        @UseGuards(() => {
          methodGuardCalls.push(1);
          return true;
        })
        @MessagePattern("guard.shortcircuit")
        handle(): string {
          return "never";
        }
      }

      server.registerHandlers(
        [ShortCtrl as unknown as Type],
        makeCtx([ShortCtrl as unknown as Type, new ShortCtrl()]),
      );

      await assertRejects(
        () =>
          server.dispatchPublic(serializePattern("guard.shortcircuit"), null),
        ForbiddenException,
      );

      assertEquals(methodGuardCalls, []);
    });
  });
});
