import {
  type ClassMethodDecoratorInitializer,
  InvalidStaticMemberDecoratorUsageError,
  type MethodDecorator,
  type Type,
} from "@denorid/injector";
import { AMQP_BINDING_METADATA } from "./_constants.ts";
import type {
  AmqpPatternType,
  PubSubOptions,
  RoutingOptions,
  RpcOptions,
  TopicOptions,
  WorkerOptions,
} from "./options.ts";

/** Union of every per-type binding option object. */
export type AmqpBindingOptions =
  | WorkerOptions
  | PubSubOptions
  | RoutingOptions
  | TopicOptions
  | RpcOptions;

/** A single decorated handler binding stored on a consumer class. */
export interface AmqpBinding {
  /** Messaging pattern this binding implements. */
  type: AmqpPatternType;
  /** The decorated method name on the consumer class. */
  method: string | symbol;
  /** The per-type topology options supplied to the decorator. */
  options: AmqpBindingOptions;
}

/**
 * Builds a method decorator that records a single {@link AmqpBinding} on the
 * owning class' metadata.
 *
 * @param {string} name - Decorator name reported in the static-usage error.
 * @param {AmqpPatternType} type - The messaging pattern literal.
 * @param {AmqpBindingOptions} options - The per-type topology options.
 * @return {MethodDecorator} The configured method decorator.
 */
export function createAmqpBindingDecorator(
  name: string,
  type: AmqpPatternType,
  options: AmqpBindingOptions,
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
        name,
        ctx.name,
        "function",
      );
    }

    const bindings =
      (ctx.metadata[AMQP_BINDING_METADATA] ??= []) as AmqpBinding[];

    bindings.push({ type, method: ctx.name, options });

    return target;
  };
}

/**
 * Reads the AMQP binding metadata recorded on a consumer class constructor.
 *
 * @param {Type} target - The consumer class constructor.
 * @return {AmqpBinding[] | undefined} The recorded bindings, or `undefined` when none.
 */
export function getAmqpBindings(target: Type): AmqpBinding[] | undefined {
  return target[Symbol.metadata]?.[AMQP_BINDING_METADATA] as
    | AmqpBinding[]
    | undefined;
}
