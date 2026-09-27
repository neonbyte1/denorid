import type { WSContext, WSReadyState } from "@hono/hono/ws";
import { eventFrame } from "./_ws_protocol.ts";

const OPEN: WSReadyState = 1;

/**
 * Client connected to a {@linkcode WsServer} of the native
 * {@linkcode WsAdapter}.
 *
 * @example
 * ```ts
 * @SubscribeMessage("join")
 * public onJoin(ctx: WsContext<typeof schema, WsClient>): void {
 *   ctx.client.join(ctx.data.room);
 *   ctx.client.emit("joined", { room: ctx.data.room });
 * }
 * ```
 */
export class WsClient {
  /** Unique id of the connection. */
  public readonly id: string = crypto.randomUUID();

  private readonly joined: Set<string> = new Set();

  /**
   * @param {WSContext} socket - Hono WebSocket context of the connection.
   * @param {Request} request - The upgrade request.
   */
  public constructor(
    private readonly socket: WSContext,
    public readonly request: Request,
  ) {}

  /**
   * Rooms the client joined. Emptied once the client disconnected.
   *
   * @return {ReadonlySet<string>} The room names.
   */
  public get rooms(): ReadonlySet<string> {
    return this.joined;
  }

  /**
   * State of the connection: `0` connecting, `1` open, `2` closing, `3`
   * closed.
   *
   * @return {WSReadyState} The state.
   */
  public get readyState(): WSReadyState {
    // Bun hands a snapshot to every event, the raw socket is live everywhere.
    const raw = this.socket.raw as { readyState?: WSReadyState } | undefined;

    return raw?.readyState ?? this.socket.readyState;
  }

  /**
   * Sends raw data. Does nothing unless the connection is open.
   *
   * @param {string | ArrayBuffer | Uint8Array<ArrayBuffer>} data - The data.
   * @return {void}
   */
  public send(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>): void {
    if (this.readyState === OPEN) {
      this.socket.send(data);
    }
  }

  /**
   * Sends an event: `{ "event": event, "data": data }`. Does nothing unless
   * the connection is open.
   *
   * @param {string} event - Event name.
   * @param {unknown} [data] - Event payload, serialized as JSON.
   * @return {void}
   */
  public emit(event: string, data?: unknown): void {
    this.send(eventFrame(event, data));
  }

  /**
   * Joins a room, see {@linkcode WsServer.to}.
   *
   * @param {string} room - Room name.
   * @return {void}
   */
  public join(room: string): void {
    this.joined.add(room);
  }

  /**
   * Leaves a room.
   *
   * @param {string} room - Room name.
   * @return {void}
   */
  public leave(room: string): void {
    this.joined.delete(room);
  }

  /**
   * Closes the connection.
   *
   * @param {number} [code] - Close code.
   * @param {string} [reason] - Close reason.
   * @return {void}
   */
  public close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}
