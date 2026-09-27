import { InjectorContext, Module } from "@denorid/injector";
import { Logger } from "@denorid/logger";
import { assertEquals, assertStrictEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { describe, it } from "node:test";
import { WEBSOCKET_GATEWAY } from "../_constants.ts";
import { getGatewayOptions } from "./_metadata.ts";
import { WebSocketGateway } from "./gateway.ts";

describe(WebSocketGateway.name, () => {
  it("stores the options", () => {
    const options = { path: "/chat", namespace: "rooms" };

    @WebSocketGateway(options)
    class ChatGateway {}

    assertStrictEquals(getGatewayOptions(ChatGateway), options);
  });

  it("stores empty options when none are passed", () => {
    @WebSocketGateway()
    class Gateway {}

    assertEquals(getGatewayOptions(Gateway), {});
  });

  it("registers a discoverable singleton provider", async () => {
    @WebSocketGateway()
    class Gateway {}

    @Module({ providers: [Gateway], exports: [Gateway] })
    class FeatureModule {}

    @Module({ imports: [FeatureModule] })
    class AppModule {}

    using _log = stub(Logger.prototype, "log");
    const ctx = await InjectorContext.create(AppModule);
    const moduleRef = ctx.getHostModuleRef();

    assertEquals(ctx.container.getTokensByTag(WEBSOCKET_GATEWAY, true), [
      Gateway,
    ]);
    assertStrictEquals(
      await moduleRef.get(Gateway, { strict: false }),
      await moduleRef.get(Gateway, { strict: false }),
    );
  });
});
