import type { Type } from "@denorid/injector/common";

/**
 * Configuration for a single queue message handler binding.
 */
export interface MessageOptions {
  /** The event identifier or pattern matched against incoming message IDs. */
  event: string | RegExp;
  /** The target queue name. Defaults to the queue defined on the handler class when omitted. */
  name?: string;
  /** Constructor used to deserialize the raw payload into a typed object. */
  dto?: Type;
}
