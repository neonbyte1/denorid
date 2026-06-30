import { ContextNotAvailableException } from "@denorid/core";
import type { Type } from "@denorid/injector";
import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { AmqpExecutionContext, AmqpHostArguments } from "./host_arguments.ts";

describe(AmqpHostArguments.name, () => {
  it("exposes the pattern and data via switchToRpc", () => {
    const host = new AmqpHostArguments("orders.created", { id: 1 });
    const rpc = host.switchToRpc();

    assertEquals(rpc.getPattern(), "orders.created");
    assertEquals(rpc.getData(), { id: 1 });
  });

  it("throws ContextNotAvailableException from switchToHttp", () => {
    const host = new AmqpHostArguments("pattern", null);

    assertThrows(
      () => host.switchToHttp(),
      ContextNotAvailableException,
    );
  });
});

describe(AmqpExecutionContext.name, () => {
  class FakeConsumer {}
  const handler = (): void => {};

  it("returns the controller class and handler fn", () => {
    const ctx = new AmqpExecutionContext(
      "rk",
      { value: 7 },
      FakeConsumer as Type,
      handler,
    );

    assertStrictEquals(ctx.getClass(), FakeConsumer);
    assertStrictEquals(ctx.getHandler(), handler);
  });

  it("still exposes pattern and data inherited from AmqpHostArguments", () => {
    const ctx = new AmqpExecutionContext(
      "rk",
      { value: 7 },
      FakeConsumer as Type,
      handler,
    );
    const rpc = ctx.switchToRpc();

    assertEquals(rpc.getPattern(), "rk");
    assertEquals(rpc.getData(), { value: 7 });
  });
});
