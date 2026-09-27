import type { InferIfZod } from "../http/request_context.ts";

/**
 * The single argument of every `@SubscribeMessage()` method.
 *
 * NestJS injects the payload and the client via parameter decorators
 * (`@MessageBody()`, `@ConnectedSocket()`). TC39 decorators have no parameter
 * decorators, so Denorid passes everything in this object instead.
 *
 * @example
 * ```ts
 * const message = z.object({ text: z.string() });
 *
 * @WebSocketGateway()
 * class ChatGateway {
 *   @SubscribeMessage("message")
 *   @MessageBody(message)
 *   public onMessage(ctx: WsContext<typeof message, WebSocket>): void {
 *     ctx.client.send(ctx.data.text);
 *   }
 * }
 * ```
 *
 * @template Dto - Zod schema passed to `@MessageBody()` (the payload type is
 *   inferred from it) or the payload type itself.
 * @template Client - Client type of the active WebSocket adapter.
 */
export class WsContext<Dto = unknown, Client = unknown> {
  /**
   * @param {string} contextId - Unique id of this message, used as the
   *   request scope of the injector.
   * @param {string} event - Event name of the message.
   * @param {InferIfZod<Dto>} data - Message payload, parsed by the
   *   `@MessageBody()` schema when there is one.
   * @param {Client} client - The client that sent the message.
   */
  public constructor(
    public readonly contextId: string,
    public readonly event: string,
    public readonly data: InferIfZod<Dto>,
    public readonly client: Client,
  ) {}
}
