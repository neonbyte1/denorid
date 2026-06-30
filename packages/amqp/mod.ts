/**
 * AMQP / RabbitMQ messaging integration for Denorid.
 *
 * Provides the five per-pattern consumer decorators (`@Worker`, `@PubSub`,
 * `@Routing`, `@Topic`, `@Rpc`) marking handler methods of an `@AmqpConsumer`
 * class, a bootstrap explorer that asserts topology and dispatches messages
 * with guard + `ExceptionHandler` integration, five sender client classes, the
 * shared `AmqpConnection`, and `AmqpModule` (`forRoot`/`forRootAsync`).
 *
 * @example Consume and publish
 * ```ts
 * import {
 *   AmqpConsumer,
 *   AmqpConnection,
 *   PublisherClient,
 *   Topic,
 * } from "@denorid/amqp";
 *
 * \@AmqpConsumer()
 * class MetricConsumer {
 *   \@Topic({ exchange: "metrics", routingKeys: ["cpu.*"] })
 *   onMetric(payload: unknown): void {
 *     console.log("metric:", payload);
 *   }
 * }
 *
 * declare const connection: AmqpConnection;
 * const publisher = new PublisherClient(connection, { exchange: "events" });
 * await publisher.publish({ kind: "started" });
 * ```
 *
 * @module
 */
export * from "./clients.ts";
export * from "./connection.ts";
export * from "./decorators.ts";
export * from "./host_arguments.ts";
export * from "./module.ts";
export * from "./module_options.ts";
export * from "./options.ts";
export * from "./serialization.ts";
