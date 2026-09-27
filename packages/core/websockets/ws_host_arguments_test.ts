import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import { ContextNotAvailableException } from "../exceptions/context_not_available.ts";
import { WsExecutionContext, WsHostArguments } from "./ws_host_arguments.ts";

describe(WsHostArguments.name, () => {
  const client = { id: "client" };

  it("exposes the client, the payload and the event via switchToWs", () => {
    const ws = new WsHostArguments("message", { text: "hi" }, client)
      .switchToWs();

    assertStrictEquals(ws.getClient(), client);
    assertEquals(ws.getData(), { text: "hi" });
    assertEquals(ws.getPattern(), "message");
  });

  it("throws from switchToHttp", () => {
    assertThrows(
      () => new WsHostArguments("message", null, client).switchToHttp(),
      ContextNotAvailableException,
      "switchToHttp() is not available in ws context. Use switchToWs() instead.",
    );
  });

  it("throws from switchToRpc", () => {
    assertThrows(
      () => new WsHostArguments("message", null, client).switchToRpc(),
      ContextNotAvailableException,
      "switchToRpc() is not available in ws context. Use switchToWs() instead.",
    );
  });
});

describe(WsExecutionContext.name, () => {
  class Gateway {}
  const handler = (): void => {};

  it("returns the gateway class and the handler", () => {
    const ctx = new WsExecutionContext("ping", 1, null, Gateway, handler);

    assertStrictEquals(ctx.getClass(), Gateway);
    assertStrictEquals(ctx.getHandler(), handler);
    assertEquals(ctx.switchToWs().getData(), 1);
  });
});
