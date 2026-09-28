/**
 * Thrown by an AMQP handler (or a guard, or a custom serializer's
 * `deserialize`) for a message that can never succeed, such as an invalid
 * payload. The message is rejected right away, skipping any remaining `retry`
 * delays: the broker dead-letters it when its queue has a dead-letter
 * exchange, and drops it otherwise.
 *
 * It is routed to the `ExceptionHandler` like any other error, so it is
 * logged and can be caught by exception filters. Without `retry` it behaves
 * like any other error.
 *
 * @example Dead-letter an invalid event without retrying it
 * ```ts
 * import { AmqpConsumer, RejectMessageException, Topic } from "@denorid/amqp";
 *
 * \@AmqpConsumer()
 * class EventsConsumer {
 *   \@Topic({
 *     exchange: "events",
 *     routingKeys: ["a.b.c"],
 *     queue: "c.events",
 *     deadLetterQueue: true,
 *     retry: { delays: [1_000, 10_000, 60_000] },
 *   })
 *   handle(event: unknown): void {
 *     if (typeof event !== "object" || event === null) {
 *       throw new RejectMessageException("Invalid event payload");
 *     }
 *   }
 * }
 * ```
 */
export class RejectMessageException extends Error {
  /**
   * @param {string} [message] - Why the message is rejected.
   * @param {ErrorOptions} [options] - Standard error options (e.g. `cause`).
   */
  public constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RejectMessageException";
  }
}
