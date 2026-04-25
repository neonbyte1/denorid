import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { MicroserviceExecutionContext } from "./execution_context.ts";

describe(MicroserviceExecutionContext.name, () => {
  class TestController {}
  const handlerFn = () => {};

  describe("getClass()", () => {
    it("returns the controller class", () => {
      const ctx = new MicroserviceExecutionContext(
        "test.pattern",
        { id: 1 },
        TestController,
        handlerFn,
      );

      assertEquals(ctx.getClass(), TestController);
    });

    it("returns the controller class with explicit type param", () => {
      const ctx = new MicroserviceExecutionContext(
        "test.pattern",
        null,
        TestController,
        handlerFn,
      );

      assertEquals(ctx.getClass<TestController>(), TestController);
    });
  });

  describe("getHandler()", () => {
    it("returns the handler function", () => {
      const ctx = new MicroserviceExecutionContext(
        "test.pattern",
        { id: 1 },
        TestController,
        handlerFn,
      );

      assertEquals(ctx.getHandler(), handlerFn);
    });
  });
});
