import {
  type Decorator,
  Injectable,
  type MethodDecorator,
  Tags,
  type Type,
} from "@denorid/injector";
import { AMQP_CONSUMER } from "./_constants.ts";
import { createAmqpBindingDecorator } from "./_metadata.ts";
import type {
  PubSubOptions,
  RoutingOptions,
  RpcOptions,
  TopicOptions,
  WorkerOptions,
} from "./options.ts";

/**
 * Class decorator that marks a class as an AMQP consumer.
 *
 * The decorated class is registered as a singleton injectable and tagged for
 * discovery by the internal explorer. Handler methods inside the class are
 * marked with one of {@link Worker}, {@link PubSub}, {@link Routing},
 * {@link Topic}, or {@link Rpc}.
 *
 * Each handler is invoked as `(payload, properties)` where `payload` is the
 * decoded message body and `properties` is the raw amqplib `MessageProperties`
 * (`headers`, `correlationId`, `replyTo`, `contentType`, etc.).
 *
 * @return {Decorator<ClassDecoratorContext, Type>} The class decorator.
 *
 * @example
 * ```ts
 * \@AmqpConsumer()
 * class OrdersConsumer {
 *   \@Worker({ queue: "orders" })
 *   process(payload: unknown): void {}
 * }
 * ```
 */
export function AmqpConsumer(): Decorator<ClassDecoratorContext, Type> {
  return (target: Type, ctx: ClassDecoratorContext): void => {
    Injectable({ mode: "singleton" })(target, ctx);
    Tags(AMQP_CONSUMER)(target, ctx);
  };
}

/**
 * Marks a method as a work-queue handler (default exchange, round-robin
 * delivery with fair dispatch via prefetch).
 *
 * @param {WorkerOptions} options - The work-queue topology options.
 * @return {MethodDecorator} The method decorator.
 *
 * @example
 * ```ts
 * \@AmqpConsumer()
 * class TaskConsumer {
 *   \@Worker({ queue: "tasks", prefetch: 1 })
 *   run(payload: unknown): void {}
 * }
 * ```
 */
export function Worker(options: WorkerOptions): MethodDecorator {
  return createAmqpBindingDecorator("Worker", "worker", options);
}

/**
 * Marks a method as a publish/subscribe handler bound to a fanout exchange.
 *
 * @param {PubSubOptions} options - The fanout topology options.
 * @return {MethodDecorator} The method decorator.
 *
 * @example
 * ```ts
 * \@AmqpConsumer()
 * class LogConsumer {
 *   \@PubSub({ exchange: "logs" })
 *   onLog(payload: unknown): void {}
 * }
 * ```
 */
export function PubSub(options: PubSubOptions): MethodDecorator {
  return createAmqpBindingDecorator("PubSub", "pub-sub", options);
}

/**
 * Marks a method as a routing handler bound to a direct exchange by one or more
 * exact routing keys.
 *
 * @param {RoutingOptions} options - The direct-exchange topology options.
 * @return {MethodDecorator} The method decorator.
 *
 * @example
 * ```ts
 * \@AmqpConsumer()
 * class AlertConsumer {
 *   \@Routing({ exchange: "alerts", routingKeys: ["error", "critical"] })
 *   onAlert(payload: unknown): void {}
 * }
 * ```
 */
export function Routing(options: RoutingOptions): MethodDecorator {
  return createAmqpBindingDecorator("Routing", "routing", options);
}

/**
 * Marks a method as a topic handler bound to a topic exchange by one or more
 * routing patterns (which may contain `*` / `#` wildcards).
 *
 * @param {TopicOptions} options - The topic-exchange topology options.
 * @return {MethodDecorator} The method decorator.
 *
 * @example
 * ```ts
 * \@AmqpConsumer()
 * class MetricConsumer {
 *   \@Topic({ exchange: "metrics", routingKeys: ["cpu.*", "mem.#"] })
 *   onMetric(payload: unknown): void {}
 * }
 * ```
 */
export function Topic(options: TopicOptions): MethodDecorator {
  return createAmqpBindingDecorator("Topic", "topic", options);
}

/**
 * Marks a method as a request/reply (RPC) handler. The method's return value is
 * published to the message's `replyTo` queue, correlated by `correlationId`.
 *
 * @param {RpcOptions} options - The request-queue topology options.
 * @return {MethodDecorator} The method decorator.
 *
 * @example
 * ```ts
 * import type { MessageProperties } from "amqplib";
 *
 * \@AmqpConsumer()
 * class MathConsumer {
 *   \@Rpc({ queue: "math.add" })
 *   add(
 *     payload: { a: number; b: number },
 *     properties: MessageProperties,
 *   ): number {
 *     console.log("correlationId:", properties.correlationId);
 *
 *     return payload.a + payload.b;
 *   }
 * }
 * ```
 */
export function Rpc(options: RpcOptions): MethodDecorator {
  return createAmqpBindingDecorator("Rpc", "rpc", options);
}
