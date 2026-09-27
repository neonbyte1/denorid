import type { Decorator } from "@denorid/injector";
import { WEBSOCKET_SERVER } from "../_constants.ts";
import { assertInstanceMember, getOwnMetadata } from "./_metadata.ts";

/**
 * Injects the gateway's server (the value returned by
 * `WebSocketAdapter.create`) into the decorated field. The field is assigned
 * while the application initializes, before `afterInit` runs.
 *
 * @example
 * ```ts
 * @WebSocketGateway()
 * class EventsGateway {
 *   @WebSocketServer()
 *   public server!: Server;
 * }
 * ```
 *
 * @return {Decorator<ClassFieldDecoratorContext>} The field decorator.
 * @throws {InvalidStaticMemberDecoratorUsageError} When applied to a static
 *   field.
 * @throws {Error} When applied to a `#private` field.
 */
export function WebSocketServer(): Decorator<ClassFieldDecoratorContext> {
  return (_: unknown, ctx: ClassFieldDecoratorContext): void => {
    assertInstanceMember("WebSocketServer", ctx, "property");

    getOwnMetadata<Set<string | symbol>>(
      ctx.metadata,
      WEBSOCKET_SERVER,
      (
        inherited: Set<string | symbol> | undefined,
      ): Set<string | symbol> => new Set(inherited),
    ).add(ctx.name);
  };
}
