import {
  InvalidStaticMemberDecoratorUsageError,
  type MethodDecorator,
} from "@denorid/injector";
import { MESSAGE_PATTERN_METADATA } from "../_constants.ts";
import type { MessageMappingMetadata } from "./metadata.ts";

export function createMessageMappingDecorator(decorator: {
  name: string;
  initializer: (entry: MessageMappingMetadata) => void;
}): MethodDecorator {
  return function <
    T extends object,
    V extends (this: T, ...args: unknown[]) => unknown,
  >(
    target: V,
    ctx: ClassMethodDecoratorContext<T, V>,
  ): V {
    if (ctx.static) {
      throw new InvalidStaticMemberDecoratorUsageError(
        decorator.name,
        ctx.name,
        "function",
      );
    }

    const entry = preserveMessageMappingMetadata(
      ctx as ClassMethodDecoratorContext,
    );

    decorator.initializer(entry);

    return target;
  };
}

function preserveMessageMappingMetadata(
  ctx: ClassMethodDecoratorContext,
): MessageMappingMetadata {
  const metadata =
    (ctx.metadata[MESSAGE_PATTERN_METADATA] ??= []) as MessageMappingMetadata[];

  let entry = metadata.find(({ name }) => name === ctx.name);

  if (!entry) {
    entry = { pattern: "", name: ctx.name, type: "message" };
    metadata.push(entry);
  }

  return entry;
}
