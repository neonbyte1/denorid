import type { Options } from "amqplib";
import type { QueueDeclarationOptions } from "./options.ts";

/** The dead-letter topology declared for a queue with `deadLetterQueue`. */
export interface DeadLetterRoute {
  /** The direct dead-letter exchange. */
  exchange: string;
  /** The key the queue dead-letters with and the dead-letter queue is bound with. */
  routingKey: string;
  /** The dead-letter queue. */
  queue: string;
}

/**
 * Resolves the dead-letter topology of a queue that opted into
 * `deadLetterQueue`, filling in the defaults derived from its name.
 *
 * @param {string} queue - The queue name.
 * @param {QueueDeclarationOptions} o - The queue declaration options.
 * @return {DeadLetterRoute | undefined} The route, or `undefined` without
 *   `deadLetterQueue`.
 */
export function deadLetterRoute(
  queue: string,
  o: QueueDeclarationOptions,
): DeadLetterRoute | undefined {
  if (!o.deadLetterQueue) {
    return undefined;
  }

  return {
    exchange: o.deadLetterExchange ?? `${queue}.dlx`,
    routingKey: o.deadLetterRoutingKey ?? queue,
    queue: typeof o.deadLetterQueue === "string"
      ? o.deadLetterQueue
      : `${queue}.dlq`,
  };
}

/**
 * Builds the `assertQueue` options of a queue, adding the typed queue options
 * (with the `deadLetterQueue` defaults) as `x-` arguments on top of the raw
 * `queueArguments`. Without any argument the `base` flags are returned
 * unchanged.
 *
 * Consumers and producers declaring the same queue must build its options
 * from the same {@link QueueDeclarationOptions}: the broker refuses a
 * redeclaration with different arguments.
 *
 * @param {string} queue - The queue name.
 * @param {QueueDeclarationOptions} o - The queue declaration options.
 * @param {Options.AssertQueue} base - Durability and exclusivity flags.
 * @return {Options.AssertQueue} The queue declaration options.
 */
export function queueDeclaration(
  queue: string,
  o: QueueDeclarationOptions,
  base: Options.AssertQueue,
): Options.AssertQueue {
  const route = deadLetterRoute(queue, o);
  const args: Record<string, unknown> = { ...o.queueArguments };
  const typed: Record<string, unknown> = {
    "x-queue-type": o.queueType,
    "x-dead-letter-exchange": route?.exchange ?? o.deadLetterExchange,
    "x-dead-letter-routing-key": route?.routingKey ?? o.deadLetterRoutingKey,
    "x-delivery-limit": o.deliveryLimit,
  };

  for (const [key, value] of Object.entries(typed)) {
    if (value !== undefined) {
      args[key] = value;
    }
  }

  return Object.keys(args).length > 0 ? { ...base, arguments: args } : base;
}
