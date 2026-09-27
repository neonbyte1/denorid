import type {
  ClassMethodDecoratorInitializer,
  MethodDecorator,
} from "@denorid/injector";
import { WEBSOCKET_SUBSCRIBE_MESSAGE } from "../_constants.ts";
import {
  assertInstanceMember,
  getOwnMetadata,
  type SubscribeMessageMetadata,
} from "./_metadata.ts";

/**
 * Subscribes a gateway method to incoming messages with the given event name.
 * The method receives a single `WsContext` argument; its return value is
 * delivered to the client (see `WsMessageHandler.callback`).
 *
 * Every event can be handled by one method per server only: within one
 * gateway, and across gateways with equal options, which share a server.
 *
 * @example
 * ```ts
 * @WebSocketGateway()
 * class EventsGateway {
 *   @SubscribeMessage("events")
 *   public onEvent(ctx: WsContext): WsResponse<unknown> {
 *     return { event: "events", data: ctx.data };
 *   }
 * }
 * ```
 *
 * @param {string} event - Event name to subscribe to.
 * @return {MethodDecorator} The method decorator.
 * @throws {InvalidStaticMemberDecoratorUsageError} When applied to a static
 *   method.
 * @throws {Error} When applied to a `#private` method.
 */
export function SubscribeMessage(event: string): MethodDecorator {
  return function <
    T extends object,
    V extends ClassMethodDecoratorInitializer<T>,
  >(
    target: V,
    ctx: ClassMethodDecoratorContext<T, V>,
  ): V {
    assertInstanceMember(
      "SubscribeMessage",
      ctx as ClassMethodDecoratorContext,
      "function",
    );

    const entries = getOwnMetadata<SubscribeMessageMetadata[]>(
      ctx.metadata,
      WEBSOCKET_SUBSCRIBE_MESSAGE,
      (
        inherited: SubscribeMessageMetadata[] | undefined,
      ): SubscribeMessageMetadata[] => [...(inherited ?? [])],
    );

    if (
      !entries.some((entry: SubscribeMessageMetadata): boolean =>
        entry.event === event && entry.name === ctx.name
      )
    ) {
      entries.push({ event, name: ctx.name });
    }

    return target;
  };
}
