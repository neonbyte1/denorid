/**
 * Options of `@WebSocketGateway()`, passed to the active WebSocket adapter.
 *
 * Adapters may accept additional keys (e.g. socket.io server options); use
 * the adapter's own options type as the decorator's type argument to get
 * them type checked.
 */
export interface GatewayOptions {
  /**
   * URL path the gateway is served on. Gateways sharing a path share one
   * server. The default depends on the adapter (`/` for the native adapter,
   * `/socket.io/` for socket.io).
   */
  path?: string;
  /**
   * Namespace of the gateway, for adapters that support namespaces
   * (socket.io).
   */
  namespace?: string;
}
