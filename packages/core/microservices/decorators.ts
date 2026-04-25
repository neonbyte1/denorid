import {
  type Decorator,
  Injectable,
  type MethodDecorator,
  Tags,
  type Type,
} from "@denorid/injector";
import { MESSAGE_CONTROLLER_METADATA } from "../_constants.ts";
import { createMessageMappingDecorator } from "./_metadata.ts";
import type { Pattern } from "./pattern.ts";

/**
 * Marks a method as a handler for the given event pattern.
 * The handler is invoked when the server receives a matching event (fire-and-forget).
 *
 * @param {Pattern} pattern - Event pattern to listen for.
 * @return {MethodDecorator}
 */
export function EventPattern(
  pattern: Pattern,
): MethodDecorator {
  return createMessageMappingDecorator({
    name: "EventPattern",
    initializer: (entry) => {
      entry.pattern = pattern;
      entry.type = "event";
    },
  });
}

/**
 * Marks a method as a handler for the given message pattern.
 * The handler is invoked when the server receives a matching request and must return a response.
 *
 * @param {Pattern} pattern - Message pattern to listen for.
 * @return {MethodDecorator}
 */
export function MessagePattern(
  pattern: Pattern,
): MethodDecorator {
  return createMessageMappingDecorator({
    name: "MessagePattern",
    initializer: (entry) => {
      entry.pattern = pattern;
      entry.type = "message";
    },
  });
}

/**
 * Marks a class as a singleton message controller.
 * Registers the class with the injector and tags it for microservice handler discovery.
 *
 * @return {Decorator<ClassDecoratorContext, Type>}
 */
export function MessageController(): Decorator<ClassDecoratorContext, Type> {
  return (target: Type, ctx: ClassDecoratorContext): void => {
    Injectable({ mode: "singleton" })(target, ctx);
    Tags(MESSAGE_CONTROLLER_METADATA)(target, ctx);
  };
}
