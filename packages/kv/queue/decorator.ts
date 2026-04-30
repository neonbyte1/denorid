import {
  type ClassMethodDecoratorInitializer,
  type Decorator,
  Injectable,
  InvalidStaticMemberDecoratorUsageError,
  type MethodDecorator,
  Tags,
  type Type,
} from "@denorid/injector";
import {
  DEFAULT_QUEUE_NAME,
  QUEUE_HANDLER,
  QUEUE_HANDLER_METADATA,
} from "../_constants.ts";
import type { MessageMetadata } from "./_metadata.ts";
import type { MessageOptions } from "./message_options.ts";

/**
 * Class decorator that marks a class as a KV queue handler.
 * The decorated class is registered as an injectable and tagged for discovery by {@link KvQueueListener}.
 *
 * @param {string} [name] - The queue name to listen on. Defaults to the default queue when omitted.
 * @return {Decorator<ClassDecoratorContext, Type>} The class decorator.
 */
export function QueueHandler(
  name?: string,
): Decorator<ClassDecoratorContext, Type> {
  return (target: Type, ctx: ClassDecoratorContext): void => {
    Injectable()(target, ctx);
    Tags(QUEUE_HANDLER)(target, ctx);

    ctx.metadata[QUEUE_HANDLER] = name ?? DEFAULT_QUEUE_NAME;
  };
}

/**
 * Marks a method as a handler for the given queue event.
 *
 * @param {string | RegExp} event - The event identifier or pattern to match against incoming message IDs.
 * @return {MethodDecorator}
 */
export function Queued(event: string | RegExp): MethodDecorator;
/**
 * Marks a method as a handler for the given queue event, deserializing the payload into `dto`.
 *
 * @param {string | RegExp} event - The event identifier or pattern to match against incoming message IDs.
 * @param {Type} dto - Constructor used to instantiate the payload.
 * @return {MethodDecorator}
 */
export function Queued(event: string | RegExp, dto: Type): MethodDecorator;
/**
 * Marks a method as a handler for the given queue event on a specific named queue.
 *
 * @param {string | RegExp} event - The event identifier or pattern to match against incoming message IDs.
 * @param {string} queue - The target queue name.
 * @return {MethodDecorator}
 */
export function Queued(event: string | RegExp, queue: string): MethodDecorator;
/**
 * Marks a method as a handler for the given queue event, targeting a specific queue and deserializing the payload.
 *
 * @param {string | RegExp} event - The event identifier or pattern to match against incoming message IDs.
 * @param {Type} dto - Constructor used to instantiate the payload.
 * @param {string} queue - The target queue name.
 * @return {MethodDecorator}
 */
export function Queued(
  event: string | RegExp,
  dto: Type,
  queue: string,
): MethodDecorator;
/**
 * Marks a method as a handler for the given queue event, targeting a specific queue and deserializing the payload.
 *
 * @param {string | RegExp} event - The event identifier or pattern to match against incoming message IDs.
 * @param {string} queue - The target queue name.
 * @param {Type} dto - Constructor used to instantiate the payload.
 * @return {MethodDecorator}
 */
export function Queued(
  event: string | RegExp,
  queue: string,
  dto: Type,
): MethodDecorator;
/**
 * Marks a method as a handler using a pre-built options object.
 *
 * @param {MessageOptions} metadata - The message options describing the event, queue, and DTO.
 * @return {MethodDecorator}
 */
export function Queued(metadata: MessageOptions): MethodDecorator;
export function Queued(
  eventOrOptions: string | RegExp | MessageOptions,
  dtoOrQueue?: Type | string,
  queueOrDto?: string | Type,
): MethodDecorator {
  return function <
    T extends object,
    V extends ClassMethodDecoratorInitializer<T>,
  >(
    target: V,
    ctx: ClassMethodDecoratorContext<T, V>,
  ): V {
    if (ctx.static) {
      throw new InvalidStaticMemberDecoratorUsageError(
        Queued.name,
        ctx.name,
        "function",
      );
    }

    const options =
      typeof eventOrOptions === "string" || eventOrOptions instanceof RegExp
        ? ({
          event: eventOrOptions,
          name: typeof dtoOrQueue === "string"
            ? dtoOrQueue
            : (typeof queueOrDto === "string" ? queueOrDto : undefined),
          dto: typeof dtoOrQueue === "function"
            ? dtoOrQueue
            : (typeof queueOrDto === "function" ? queueOrDto : undefined),
        } satisfies MessageOptions)
        : eventOrOptions;

    const cache =
      (ctx.metadata[QUEUE_HANDLER_METADATA] ??= []) as MessageMetadata[];

    cache.push({ ...options, method: ctx.name });

    return target;
  };
}
