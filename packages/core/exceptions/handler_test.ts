import type { InjectorContext, Type } from "@denorid/injector";
import type { Logger } from "@denorid/logger";
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy } from "@std/testing/mock";
import type { HostArguments } from "../host_arguments.ts";
import { Catch, type ExceptionFilter } from "./filter.ts";
import { ExceptionHandler } from "./handler.ts";
import { IntrinsicException } from "./intrinsic.ts";

describe("ExceptionHandler", () => {
  class TestError extends Error {}
  class AnotherError extends Error {}

  const mockHost: HostArguments = {
    switchToHttp: () => ({
      getRequest<T = unknown>(): T {
        return undefined as T;
      },
      getResponse<T = unknown>(): T {
        return undefined as T;
      },
    }),
  };

  function makeCtx(
    tokens: Type[],
    resolveMap: Map<Type, ExceptionFilter>,
  ): InjectorContext {
    return {
      container: { getTokensByTag: () => tokens },
      resolveInternal: (token: Type) =>
        Promise.resolve(resolveMap.get(token) as ExceptionFilter),
    } as unknown as InjectorContext;
  }

  function disableLoggerOutput(handler: ExceptionHandler): void {
    (handler["logger"] as Logger)["options"].levels = [];
  }

  describe("register", () => {
    it("does nothing when no tagged tokens exist", async () => {
      const handler = new ExceptionHandler(makeCtx([], new Map()));

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(handler.canHandle(new TestError()), false);
    });

    it("skips filters that have no EXCEPTION_FILTER_METADATA", async () => {
      class NoMetaFilter implements ExceptionFilter {
        catch(): unknown {
          return undefined;
        }
      }

      const token = NoMetaFilter as unknown as Type;
      const ctx = makeCtx([token], new Map([[token, new NoMetaFilter()]]));
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(handler.canHandle(new TestError()), false);
    });

    it("registers a filter with default priority when none is given", async () => {
      @Catch(TestError)
      class DefaultPriorityFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          return "ok";
        }
      }

      const token = DefaultPriorityFilter as unknown as Type;
      const ctx = makeCtx(
        [token],
        new Map([[token, new DefaultPriorityFilter()]]),
      );
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(handler.canHandle(new TestError()), true);
    });

    it("registers a filter with an explicit priority", async () => {
      @Catch(TestError, { priority: 42 })
      class HighPriorityFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          return "ok";
        }
      }

      const token = HighPriorityFilter as unknown as Type;
      const ctx = makeCtx(
        [token],
        new Map([[token, new HighPriorityFilter()]]),
      );
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(handler.canHandle(new TestError()), true);
    });
  });

  describe("canHandle", () => {
    it("returns false for a non-Error value (string)", () => {
      const handler = new ExceptionHandler(makeCtx([], new Map()));

      assertEquals(handler.canHandle("not an error"), false);
    });

    it("returns false for null", () => {
      const handler = new ExceptionHandler(makeCtx([], new Map()));

      assertEquals(handler.canHandle(null), false);
    });

    it("returns false for an Error with no registered filter", () => {
      const handler = new ExceptionHandler(makeCtx([], new Map()));

      assertEquals(handler.canHandle(new TestError()), false);
    });

    it("returns true for an Error with a registered filter", async () => {
      @Catch(TestError)
      class SomeFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          return "handled";
        }
      }

      const token = SomeFilter as unknown as Type;
      const ctx = makeCtx([token], new Map([[token, new SomeFilter()]]));
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(handler.canHandle(new TestError()), true);
    });

    it("returns false for an unregistered error type", async () => {
      @Catch(TestError)
      class TestFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          return "handled";
        }
      }

      const token = TestFilter as unknown as Type;
      const ctx = makeCtx([token], new Map([[token, new TestFilter()]]));
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(handler.canHandle(new AnotherError()), false);
    });
  });

  describe("handle", () => {
    it("returns undefined for a non-Error value", async () => {
      const handler = new ExceptionHandler(makeCtx([], new Map()));

      disableLoggerOutput(handler);

      assertEquals(await handler.handle("oops", mockHost), undefined);
    });

    it("returns undefined when no filter is registered for the error type", async () => {
      const handler = new ExceptionHandler(makeCtx([], new Map()));

      disableLoggerOutput(handler);

      assertEquals(await handler.handle(new TestError(), mockHost), undefined);
    });

    it("returns the filter result directly when a single filter returns a value", async () => {
      @Catch(TestError)
      class ReturnFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          return "caught";
        }
      }

      const token = ReturnFilter as unknown as Type;
      const ctx = makeCtx([token], new Map([[token, new ReturnFilter()]]));
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(await handler.handle(new TestError(), mockHost), "caught");
    });

    it("returns undefined when the single filter returns null", async () => {
      @Catch(TestError)
      class NullFilter implements ExceptionFilter<TestError> {
        catch(): null {
          return null;
        }
      }

      const token = NullFilter as unknown as Type;
      const ctx = makeCtx([token], new Map([[token, new NullFilter()]]));
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(await handler.handle(new TestError(), mockHost), undefined);
    });

    it("returns undefined when the single filter returns undefined", async () => {
      @Catch(TestError)
      class VoidFilter implements ExceptionFilter<TestError> {
        catch(): undefined {
          return undefined;
        }
      }

      const token = VoidFilter as unknown as Type;
      const ctx = makeCtx([token], new Map([[token, new VoidFilter()]]));
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(await handler.handle(new TestError(), mockHost), undefined);
    });

    it("returns an array when multiple filters each return a value", async () => {
      @Catch(TestError)
      class FilterA implements ExceptionFilter<TestError> {
        catch(): unknown {
          return "a";
        }
      }

      @Catch(TestError)
      class FilterB implements ExceptionFilter<TestError> {
        catch(): unknown {
          return "b";
        }
      }

      const tokenA = FilterA as unknown as Type;
      const tokenB = FilterB as unknown as Type;
      const ctx = makeCtx(
        [tokenA, tokenB],
        new Map([
          [tokenA, new FilterA()],
          [tokenB, new FilterB()],
        ]),
      );
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(await handler.handle(new TestError(), mockHost), ["a", "b"]);
    });

    it("returns undefined and does not throw when the filter rejects", async () => {
      @Catch(TestError)
      class ThrowingFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          return Promise.reject(new Error("filter boom"));
        }
      }

      const token = ThrowingFilter as unknown as Type;
      const ctx = makeCtx([token], new Map([[token, new ThrowingFilter()]]));
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(
        await handler.handle(new TestError(), mockHost),
        undefined,
      );
    });

    it("does not call logger.error when the error is an IntrinsicException", async () => {
      @Catch(IntrinsicException)
      class IntrinsicFilter implements ExceptionFilter<IntrinsicException> {
        catch(): unknown {
          return "intrinsic";
        }
      }

      const token = IntrinsicFilter as unknown as Type;
      const ctx = makeCtx(
        [token],
        new Map([[token, new IntrinsicFilter()]]),
      );
      const handler = new ExceptionHandler(ctx);
      const loggerErrorSpy = spy(
        handler["logger"] as Logger,
        "error" as keyof Logger,
      );

      disableLoggerOutput(handler);

      await handler.register();
      await handler.handle(new IntrinsicException("intrinsic"), mockHost);

      assertSpyCalls(loggerErrorSpy, 0);
    });

    it("returns the succeeding value when one filter throws and another resolves", async () => {
      @Catch(TestError)
      class GoodFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          return "ok";
        }
      }

      @Catch(TestError)
      class BadFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          return Promise.reject(new Error("boom"));
        }
      }

      const tokenGood = GoodFilter as unknown as Type;
      const tokenBad = BadFilter as unknown as Type;
      const ctx = makeCtx(
        [tokenGood, tokenBad],
        new Map([
          [tokenGood, new GoodFilter()],
          [tokenBad, new BadFilter()],
        ]),
      );
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();

      assertEquals(await handler.handle(new TestError(), mockHost), "ok");
    });
  });

  describe("priority ordering (registerExceptionFilterInCache)", () => {
    it("inserts a higher-priority filter before a lower-priority one (insertAt !== -1)", async () => {
      const order: number[] = [];

      @Catch(TestError, { priority: 1 })
      class LowFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          order.push(1);
          return "low";
        }
      }

      @Catch(TestError, { priority: 10 })
      class HighFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          order.push(10);
          return "high";
        }
      }

      const tokenLow = LowFilter as unknown as Type;
      const tokenHigh = HighFilter as unknown as Type;
      const ctx = makeCtx(
        [tokenLow, tokenHigh],
        new Map([
          [tokenLow, new LowFilter()],
          [tokenHigh, new HighFilter()],
        ]),
      );
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();
      await handler.handle(new TestError(), mockHost);

      assertEquals(order, [10, 1]);
    });

    it("appends a lower-priority entry after all existing entries (insertAt === -1)", async () => {
      const order: number[] = [];

      @Catch(TestError, { priority: 5 })
      class MidFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          order.push(5);
          return "mid";
        }
      }

      @Catch(TestError, { priority: 3 })
      class TailFilter implements ExceptionFilter<TestError> {
        catch(): unknown {
          order.push(3);
          return "tail";
        }
      }

      const tokenMid = MidFilter as unknown as Type;
      const tokenTail = TailFilter as unknown as Type;
      const ctx = makeCtx(
        [tokenMid, tokenTail],
        new Map([
          [tokenMid, new MidFilter()],
          [tokenTail, new TailFilter()],
        ]),
      );
      const handler = new ExceptionHandler(ctx);

      disableLoggerOutput(handler);

      await handler.register();
      await handler.handle(new TestError(), mockHost);

      assertEquals(order, [5, 3]);
    });
  });
});
