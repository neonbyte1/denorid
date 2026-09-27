import {
  InvalidStaticMemberDecoratorUsageError,
  type Type,
} from "@denorid/injector";
import type { ZodType } from "zod";
import {
  WEBSOCKET_GATEWAY_OPTIONS,
  WEBSOCKET_MESSAGE_BODY,
  WEBSOCKET_SERVER,
  WEBSOCKET_SUBSCRIBE_MESSAGE,
} from "../_constants.ts";
import type { GatewayOptions } from "./gateway_options.ts";

/**
 * Entry stored by `@SubscribeMessage()` for every subscribed event.
 */
export interface SubscribeMessageMetadata {
  /** Event name the method handles. */
  event: string;
  /** Name of the gateway method. */
  name: string | symbol;
}

/**
 * Throws when a member decorator is applied to a static or `#private` member.
 *
 * @param {string} decorator - Decorator name, without `@` and `()`.
 * @param {ClassMethodDecoratorContext | ClassFieldDecoratorContext} ctx -
 *   Decorator context of the member.
 * @param {"function" | "property"} memberType - Kind of the member.
 * @return {void}
 */
export function assertInstanceMember(
  decorator: string,
  ctx: ClassMethodDecoratorContext | ClassFieldDecoratorContext,
  memberType: "function" | "property",
): void {
  if (ctx.static) {
    throw new InvalidStaticMemberDecoratorUsageError(
      decorator,
      ctx.name,
      memberType,
    );
  }

  if (ctx.private) {
    throw new Error(
      `Decorator @${decorator}() cannot be applied to private ${memberType} "${
        String(ctx.name)
      }". Use a member without "#" instead.`,
    );
  }
}

/**
 * Returns the metadata value stored under `key` that belongs to the decorated
 * class itself. A value inherited from a parent class is cloned first, so
 * decorating a subclass never changes the metadata of its parent.
 *
 * @param {DecoratorMetadataObject} metadata - `ctx.metadata` of the decorator.
 * @param {symbol} key - Metadata key.
 * @param {(inherited: T | undefined) => T} clone - Creates the own value from
 *   the inherited one (`undefined` when there is none).
 * @return {T} The own, mutable value.
 */
export function getOwnMetadata<T>(
  metadata: DecoratorMetadataObject,
  key: symbol,
  clone: (inherited: T | undefined) => T,
): T {
  if (!Object.hasOwn(metadata, key)) {
    metadata[key] = clone(metadata[key] as T | undefined);
  }

  return metadata[key] as T;
}

/**
 * Reads the options passed to `@WebSocketGateway()`.
 *
 * @param {Type} gateway - The gateway class.
 * @return {GatewayOptions} The options, `{}` when there are none.
 */
export function getGatewayOptions(gateway: Type): GatewayOptions {
  return (gateway[Symbol.metadata]?.[WEBSOCKET_GATEWAY_OPTIONS] as
    | GatewayOptions
    | undefined) ?? {};
}

/**
 * Reads the events subscribed via `@SubscribeMessage()`.
 *
 * @param {Type} gateway - The gateway class.
 * @return {readonly SubscribeMessageMetadata[]} The subscriptions.
 */
export function getSubscribeMessageMetadata(
  gateway: Type,
): readonly SubscribeMessageMetadata[] {
  return (gateway[Symbol.metadata]?.[WEBSOCKET_SUBSCRIBE_MESSAGE] as
    | SubscribeMessageMetadata[]
    | undefined) ?? [];
}

/**
 * Reads the schema passed to `@MessageBody()` for the method `name`.
 *
 * @param {Type} gateway - The gateway class.
 * @param {string | symbol} name - Name of the gateway method.
 * @return {ZodType | undefined} The schema, `undefined` without validation.
 */
export function getMessageBodySchema(
  gateway: Type,
  name: string | symbol,
): ZodType | undefined {
  return (gateway[Symbol.metadata]?.[WEBSOCKET_MESSAGE_BODY] as
    | Map<string | symbol, ZodType>
    | undefined)?.get(name);
}

/**
 * Reads the fields decorated with `@WebSocketServer()`.
 *
 * @param {Type} gateway - The gateway class.
 * @return {ReadonlySet<string | symbol>} The field names.
 */
export function getWebSocketServerFields(
  gateway: Type,
): ReadonlySet<string | symbol> {
  return (gateway[Symbol.metadata]?.[WEBSOCKET_SERVER] as
    | Set<string | symbol>
    | undefined) ?? new Set();
}
