import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { RpcExecutionContext, RpcHostArguments } from "./rpc_host_arguments.ts";

describe(RpcHostArguments.name, () => {
  describe("switchToHttp()", () => {
    it("throws - HTTP context not available in rpc", () => {
      const host = new RpcHostArguments("test.pattern", { id: 1 });

      assertThrows(
        () => host.switchToHttp(),
        Error,
        "switchToHttp() is not available in rpc context",
      );
    });
  });

  describe("switchToRpc()", () => {
    it("returns the pattern and data", () => {
      const data = { id: 42 };
      const host = new RpcHostArguments("user.find", data);
      const rpc = host.switchToRpc();

      assertEquals(rpc.getPattern(), "user.find");
      assertEquals(rpc.getData(), data);
    });

    it("handles primitive payloads", () => {
      const host = new RpcHostArguments("ping", "hello");
      const rpc = host.switchToRpc();

      assertEquals(rpc.getPattern(), "ping");
      assertEquals(rpc.getData(), "hello");
    });

    it("handles undefined payload", () => {
      const host = new RpcHostArguments("noop", undefined);
      assertEquals(host.switchToRpc().getData(), undefined);
    });

    it("handles object pattern", () => {
      const host = new RpcHostArguments({ cmd: "find" }, null);
      assertEquals(host.switchToRpc().getPattern(), { cmd: "find" });
    });
  });
});

describe(RpcExecutionContext.name, () => {
  class TestController {}
  const handlerFn = () => {};

  describe("getClass()", () => {
    it("returns the controller class", () => {
      const ctx = new RpcExecutionContext(
        "test.pattern",
        { id: 1 },
        TestController,
        handlerFn,
      );

      assertEquals(ctx.getClass(), TestController);
    });

    it("returns the controller class with explicit type param", () => {
      const ctx = new RpcExecutionContext(
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
      const ctx = new RpcExecutionContext(
        "test.pattern",
        { id: 1 },
        TestController,
        handlerFn,
      );

      assertEquals(ctx.getHandler(), handlerFn);
    });
  });
});
