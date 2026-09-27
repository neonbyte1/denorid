import { eventFrame } from "./_ws_protocol.ts";
import type { WsClient } from "./ws_client.ts";

/**
 * Sends events to a subset of the clients of a {@linkcode WsServer}.
 */
export interface WsBroadcast {
  /**
   * Sends an event: `{ "event": event, "data": data }`.
   *
   * @param {string} event - Event name.
   * @param {unknown} [data] - Event payload, serialized as JSON.
   * @return {void}
   */
  emit(event: string, data?: unknown): void;
}

/**
 * Server of the native {@linkcode WsAdapter} for one path, shared by every
 * gateway on that path. Injected into `@WebSocketServer()` fields.
 *
 * @example
 * ```ts
 * @WebSocketGateway({ path: "/chat" })
 * class ChatGateway {
 *   @WebSocketServer()
 *   public server!: WsServer;
 *
 *   public announce(text: string): void {
 *     this.server.emit("announcement", { text });
 *     this.server.to("admins").emit("audit", { text });
 *   }
 * }
 * ```
 */
export class WsServer {
  /**
   * @param {string} path - URL path the server is reachable on.
   * @param {ReadonlySet<WsClient>} clients - Connected clients, kept up to
   *   date by the adapter.
   */
  public constructor(
    public readonly path: string,
    public readonly clients: ReadonlySet<WsClient>,
  ) {}

  /**
   * Sends an event to every connected client.
   *
   * @param {string} event - Event name.
   * @param {unknown} [data] - Event payload, serialized as JSON.
   * @return {void}
   */
  public emit(event: string, data?: unknown): void {
    const frame = eventFrame(event, data);

    for (const client of this.clients) {
      client.send(frame);
    }
  }

  /**
   * Selects the clients in at least one of the given rooms, see
   * {@linkcode WsClient.join}. Every client receives an event at most once.
   *
   * @param {string | readonly string[]} room - One or several room names.
   * @return {WsBroadcast} Sends events to the selected clients.
   */
  public to(room: string | readonly string[]): WsBroadcast {
    const rooms = typeof room === "string" ? [room] : room;

    return {
      emit: (event: string, data?: unknown): void => {
        const frame = eventFrame(event, data);

        for (const client of this.clients) {
          if (rooms.some((name) => client.rooms.has(name))) {
            client.send(frame);
          }
        }
      },
    };
  }
}
