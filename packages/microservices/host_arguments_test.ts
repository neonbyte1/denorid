import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { MicroserviceHostArguments } from "./host_arguments.ts";

describe(MicroserviceHostArguments.name, () => {
  describe("switchToHttp()", () => {
    it("throws - HTTP context not available in microservice", () => {
      const host = new MicroserviceHostArguments("test.pattern", { id: 1 });

      assertThrows(
        () => host.switchToHttp(),
        Error,
        "switchToHttp() is not available in microservice context",
      );
    });
  });

  describe("switchToRpc()", () => {
    it("returns the pattern and data", () => {
      const data = { id: 42 };
      const host = new MicroserviceHostArguments("user.find", data);
      const rpc = host.switchToRpc();

      assertEquals(rpc.getPattern(), "user.find");
      assertEquals(rpc.getData(), data);
    });

    it("handles primitive payloads", () => {
      const host = new MicroserviceHostArguments("ping", "hello");
      const rpc = host.switchToRpc();

      assertEquals(rpc.getPattern(), "ping");
      assertEquals(rpc.getData(), "hello");
    });

    it("handles undefined payload", () => {
      const host = new MicroserviceHostArguments("noop", undefined);
      assertEquals(host.switchToRpc().getData(), undefined);
    });

    it("handles object pattern", () => {
      const host = new MicroserviceHostArguments({ cmd: "find" }, null);
      assertEquals(host.switchToRpc().getPattern(), { cmd: "find" });
    });
  });
});
