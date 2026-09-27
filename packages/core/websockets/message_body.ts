import type {
  ClassMethodDecoratorInitializer,
  MethodDecorator,
} from "@denorid/injector";
import type { ZodType } from "zod";
import { WEBSOCKET_MESSAGE_BODY } from "../_constants.ts";
import { assertInstanceMember, getOwnMetadata } from "./_metadata.ts";

/**
 * Validates the payload of every message handled by the decorated gateway
 * method with a Zod schema, after the guards passed.
 *
 * On success, `WsContext.data` is the parsed value. On failure, the method is
 * not called and the client receives
 * `{ status: "error", message: string[] }` (one message per issue) as a
 * `WsException`.
 *
 * TC39 decorators have no parameter decorators, so unlike NestJS this is a
 * method decorator; use `WsContext<typeof schema>` to type the payload.
 *
 * @example
 * ```ts
 * const message = z.object({ text: z.string() });
 *
 * @WebSocketGateway()
 * class ChatGateway {
 *   @SubscribeMessage("message")
 *   @MessageBody(message)
 *   public onMessage(ctx: WsContext<typeof message>): string {
 *     return ctx.data.text;
 *   }
 * }
 * ```
 *
 * @param {ZodType} schema - Schema the payload must match.
 * @return {MethodDecorator} The method decorator.
 * @throws {InvalidStaticMemberDecoratorUsageError} When applied to a static
 *   method.
 * @throws {Error} When applied to a `#private` method.
 */
export function MessageBody(schema: ZodType): MethodDecorator {
  return function <
    T extends object,
    V extends ClassMethodDecoratorInitializer<T>,
  >(
    target: V,
    ctx: ClassMethodDecoratorContext<T, V>,
  ): V {
    assertInstanceMember(
      "MessageBody",
      ctx as ClassMethodDecoratorContext,
      "function",
    );

    getOwnMetadata<Map<string | symbol, ZodType>>(
      ctx.metadata,
      WEBSOCKET_MESSAGE_BODY,
      (
        inherited: Map<string | symbol, ZodType> | undefined,
      ): Map<string | symbol, ZodType> => new Map(inherited),
    ).set(ctx.name, schema);

    return target;
  };
}
