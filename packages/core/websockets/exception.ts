import { IntrinsicException } from "../exceptions/intrinsic.ts";

/**
 * Event name adapters use to send failed messages to the client.
 */
export const WS_EXCEPTION_EVENT = "exception";

/**
 * Exception for WebSocket gateways. Its payload is sent to the client as
 * event {@link WS_EXCEPTION_EVENT}; any other error thrown by a gateway method
 * is sent as `{ status: "error", message: "Internal server error" }`.
 *
 * @example
 * ```ts
 * throw new WsException("Room is full");
 * // client receives: { status: "error", message: "Room is full" }
 *
 * throw new WsException({ code: "ROOM_FULL", room: "lobby" });
 * // client receives: { code: "ROOM_FULL", room: "lobby" }
 * ```
 */
export class WsException extends IntrinsicException {
  /**
   * @param {string | Record<string, unknown>} error - Message, or the payload
   *   sent to the client as is.
   */
  public constructor(private readonly error: string | Record<string, unknown>) {
    super(typeof error === "string" ? error : JSON.stringify(error));
    this.name = "WsException";
  }

  /**
   * Returns the error passed to the constructor.
   *
   * @return {string | Record<string, unknown>} The error.
   */
  public getError(): string | Record<string, unknown> {
    return this.error;
  }

  /**
   * Returns the payload sent to the client.
   *
   * @return {Record<string, unknown>} `{ status: "error", message }` for
   *   string errors, the error object otherwise.
   */
  public getPayload(): Record<string, unknown> {
    return typeof this.error === "string"
      ? { status: "error", message: this.error }
      : this.error;
  }
}
