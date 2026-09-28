import type { Options } from "amqplib";
import type { QueueDeclarationOptions } from "./options.ts";

/**
 * Builds the `assertQueue` options of a queue, adding the typed queue options
 * as `x-` arguments on top of the raw `queueArguments`. Without any argument
 * the `base` flags are returned unchanged.
 *
 * Consumers and producers declaring the same queue must build its options
 * from the same {@link QueueDeclarationOptions}: the broker refuses a
 * redeclaration with different arguments.
 *
 * @param {QueueDeclarationOptions} o - The queue declaration options.
 * @param {Options.AssertQueue} base - Durability and exclusivity flags.
 * @return {Options.AssertQueue} The queue declaration options.
 */
export function queueDeclaration(
  o: QueueDeclarationOptions,
  base: Options.AssertQueue,
): Options.AssertQueue {
  const args: Record<string, unknown> = { ...o.queueArguments };
  const typed: Record<string, unknown> = {
    "x-queue-type": o.queueType,
    "x-dead-letter-exchange": o.deadLetterExchange,
    "x-dead-letter-routing-key": o.deadLetterRoutingKey,
    "x-delivery-limit": o.deliveryLimit,
  };

  for (const [key, value] of Object.entries(typed)) {
    if (value !== undefined) {
      args[key] = value;
    }
  }

  return Object.keys(args).length > 0 ? { ...base, arguments: args } : base;
}
