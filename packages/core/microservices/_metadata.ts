import type { MethodDecorator } from "@denorid/injector";
import { MESSAGE_PATTERN_METADATA } from "../_constants.ts";
import {
  assertInstanceMember,
  getOwnMetadata,
} from "../websockets/_metadata.ts";
import type { MessageMappingMetadata } from "./metadata.ts";

/**
 * Creates a method decorator that upserts the {@linkcode MessageMappingMetadata}
 * entry of the decorated method and lets `initializer` fill it.
 *
 * @param {{ name: string; initializer: (entry: MessageMappingMetadata) => void }} decorator -
 *   Decorator name (without `@` and `()`) used in error messages, and the
 *   function that writes the pattern and type into the entry.
 * @return {MethodDecorator} The method decorator.
 * @throws {InvalidStaticMemberDecoratorUsageError} When applied to a static
 *   method.
 * @throws {Error} When applied to a `#private` method.
 */
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
    assertInstanceMember(
      decorator.name,
      ctx as ClassMethodDecoratorContext,
      "function",
    );

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
  // Entries are updated in place, so inherited entries are copied as well.
  const metadata = getOwnMetadata<MessageMappingMetadata[]>(
    ctx.metadata,
    MESSAGE_PATTERN_METADATA,
    (
      inherited: MessageMappingMetadata[] | undefined,
    ): MessageMappingMetadata[] =>
      (inherited ?? []).map((
        entry: MessageMappingMetadata,
      ): MessageMappingMetadata => ({ ...entry })),
  );

  let entry = metadata.find(({ name }) => name === ctx.name);

  if (!entry) {
    entry = { pattern: "", name: ctx.name, type: "message" };
    metadata.push(entry);
  }

  return entry;
}
