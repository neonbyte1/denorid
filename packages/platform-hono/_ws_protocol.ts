import { isWsResponse, WS_EXCEPTION_EVENT, WsException } from "@denorid/core";

/**
 * Id a client attaches to a message to receive the reply.
 */
export type WsMessageId = string | number;

/**
 * Message sent by a client: `{ "event": string, "data"?: unknown, "id"?: string | number }`.
 */
export interface WsMessage {
  /** Event name, routed to the handler bound for it. */
  event: string;
  /** Payload passed to the handler. */
  data: unknown;
  /** Id echoed in the reply, when the client expects one. */
  id?: WsMessageId;
}

const INTERNAL_ERROR: Record<string, unknown> = new WsException(
  "Internal server error",
).getPayload();

/**
 * Parses a received WebSocket message.
 *
 * @param {unknown} data - Received data, a string for text frames.
 * @return {WsMessage | undefined} The message, or `undefined` for binary
 *   frames, invalid JSON, non-objects and messages without a string `event`.
 *   An `id` that is neither a string nor a number is dropped.
 */
export function parseMessage(data: unknown): WsMessage | undefined {
  if (typeof data !== "string") {
    return undefined;
  }

  let message: unknown;

  try {
    message = JSON.parse(data);
  } catch {
    return undefined;
  }

  if (typeof message !== "object" || message === null) {
    return undefined;
  }

  const { event, data: payload, id } = message as Record<string, unknown>;

  if (typeof event !== "string") {
    return undefined;
  }

  return typeof id === "string" || typeof id === "number"
    ? { event, data: payload, id }
    : { event, data: payload };
}

/**
 * Serializes an event sent to a client: `{ "event": event, "data": data }`.
 *
 * @param {string} event - Event name.
 * @param {unknown} data - Event payload.
 * @return {string} The frame.
 */
export function eventFrame(event: string, data: unknown): string {
  return JSON.stringify({ event, data });
}

/**
 * Serializes the result of a message handler.
 *
 * @param {unknown} result - Value the handler resolved with.
 * @param {WsMessageId} [id] - Id of the message.
 * @return {string | undefined} `undefined` for `undefined` results, an event
 *   frame for `WsResponse` results, otherwise the reply: `{ "id": id, "data":
 *   result }` with an id, the serialized result as is without one.
 * @throws {TypeError} When the result cannot be serialized.
 */
export function resultFrame(
  result: unknown,
  id?: WsMessageId,
): string | undefined {
  if (result === undefined) {
    return undefined;
  }

  if (isWsResponse(result)) {
    return eventFrame(result.event, result.data);
  }

  return JSON.stringify(id === undefined ? result : { id, data: result });
}

/**
 * Serializes a failed message: `{ "event": "exception", "data": payload }`
 * plus the `id` of the message, if any. The payload of a {@linkcode
 * WsException} is sent as is; any other error, or a payload that cannot be
 * serialized, is sent as `{ status: "error", message: "Internal server error" }`.
 *
 * @param {unknown} error - The error the message failed with.
 * @param {WsMessageId} [id] - Id of the message.
 * @return {string} The frame.
 */
export function exceptionFrame(error: unknown, id?: WsMessageId): string {
  const frame: Record<string, unknown> = id === undefined
    ? { event: WS_EXCEPTION_EVENT, data: INTERNAL_ERROR }
    : { event: WS_EXCEPTION_EVENT, data: INTERNAL_ERROR, id };

  if (error instanceof WsException) {
    try {
      return JSON.stringify({ ...frame, data: error.getPayload() });
    } catch {
      // Not serializable: falls back to the generic payload.
    }
  }

  return JSON.stringify(frame);
}
