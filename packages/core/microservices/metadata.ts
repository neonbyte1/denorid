import { MESSAGE_PATTERN_METADATA } from "../_constants.ts";
import type { PatternType } from "./pattern.ts";
import type { Type } from "@denorid/injector";

/**
 * Metadata entry stored for each pattern-annotated method on a message controller.
 */
export interface MessageMappingMetadata {
  /** The pattern matched against incoming messages. May be a string or a plain object. */
  pattern: string | Record<string, unknown>;
  /** The method name on the controller class. */
  name: string | symbol;
  /** Whether this is a request-response or fire-and-forget handler. */
  type: PatternType;
}

/**
 * Reads pattern metadata from a class constructor's `Symbol.metadata`.
 *
 * @param {Type} target - The class constructor to read metadata from.
 * @return {MessageMappingMetadata[] | undefined} Registered pattern entries, or `undefined` if none.
 */
export function getMessageMappingMetadata(
  target: Type,
): MessageMappingMetadata[] | undefined {
  const metadata = target[Symbol.metadata];

  if (metadata == null) {
    return undefined;
  }

  return metadata[MESSAGE_PATTERN_METADATA] as
    | MessageMappingMetadata[]
    | undefined;
}
