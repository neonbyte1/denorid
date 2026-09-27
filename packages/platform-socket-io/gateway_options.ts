import type { GatewayOptions } from "@denorid/core/websockets";
import type { ServerOptions } from "socket.io";

/**
 * Options of `@WebSocketGateway()` understood by `SocketIoAdapter`: the core
 * gateway options plus every socket.io server option.
 *
 * Gateways sharing a `path` share one socket.io `Server`. Its server options
 * are taken from the first gateway created for that path (merged over the
 * adapter's constructor options); server options of later gateways on the
 * same path are ignored, they only select their `namespace`.
 *
 * @example
 * ```ts
 * @WebSocketGateway<SocketIoGatewayOptions>({
 *   namespace: "/chat",
 *   cors: { origin: "https://example.com" },
 * })
 * class ChatGateway {}
 * ```
 */
export interface SocketIoGatewayOptions
  extends GatewayOptions, Partial<ServerOptions> {
  /**
   * engine.io path the socket.io server listens on. Defaults to the adapter's
   * `path` option, then `/socket.io` (a trailing slash is ignored).
   */
  path?: string;
  /**
   * socket.io namespace of the gateway (`io.of(namespace)`). Without one the
   * gateway uses the main namespace (`/`) and receives the `Server`.
   */
  namespace?: string;
}
