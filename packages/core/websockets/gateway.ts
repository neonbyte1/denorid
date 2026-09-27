import { type Decorator, Injectable, Tags, type Type } from "@denorid/injector";
import { WEBSOCKET_GATEWAY, WEBSOCKET_GATEWAY_OPTIONS } from "../_constants.ts";
import type { GatewayOptions } from "./gateway_options.ts";

/**
 * Marks a class as a singleton WebSocket gateway. Its `@SubscribeMessage()`
 * methods are bound to the application's WebSocket adapter while the HTTP
 * application initializes. Add the class to the `providers` of a module.
 *
 * @example
 * ```ts
 * @WebSocketGateway({ path: "/chat" })
 * class ChatGateway {
 *   @SubscribeMessage("ping")
 *   public ping(): string {
 *     return "pong";
 *   }
 * }
 * ```
 *
 * @template T - Options type of the active WebSocket adapter.
 * @param {T} [options] - Options passed to `WebSocketAdapter.create`.
 * @return {Decorator<ClassDecoratorContext, Type>} The class decorator.
 */
export function WebSocketGateway<T extends GatewayOptions = GatewayOptions>(
  options?: T,
): Decorator<ClassDecoratorContext, Type> {
  return (target: Type, ctx: ClassDecoratorContext): void => {
    Injectable({ mode: "singleton" })(target, ctx);
    Tags(WEBSOCKET_GATEWAY)(target, ctx);

    ctx.metadata[WEBSOCKET_GATEWAY_OPTIONS] = options ?? {};
  };
}
