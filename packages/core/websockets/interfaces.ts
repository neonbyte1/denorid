/**
 * Response of a gateway method that is sent to the client as an event
 * instead of a reply.
 *
 * @template T - Payload type.
 */
export interface WsResponse<T = unknown> {
  /** Event name the client receives. */
  event: string;
  /** Event payload. */
  data: T;
}

/**
 * Checks whether `value` is a {@link WsResponse}: an object with a string
 * `event` and a `data` key.
 *
 * @param {unknown} value - Value returned by a gateway method.
 * @return {boolean} `true` when `value` is a {@link WsResponse}.
 */
export function isWsResponse(value: unknown): value is WsResponse {
  return typeof value === "object" && value !== null &&
    typeof (value as { event?: unknown }).event === "string" &&
    "data" in value;
}

/**
 * Hook called once the gateway's server was created.
 *
 * @template TServer - Server type of the active WebSocket adapter.
 */
export interface OnGatewayInit<TServer = unknown> {
  /**
   * @param {TServer} server - The gateway's server.
   * @return {unknown} May return a promise; it is awaited.
   */
  afterInit(server: TServer): unknown;
}

/**
 * Hook called for every client connecting to the gateway.
 *
 * @template TClient - Client type of the active WebSocket adapter.
 */
export interface OnGatewayConnection<TClient = unknown> {
  /**
   * @param {TClient} client - The connected client.
   * @param {...unknown[]} args - Adapter specific arguments (e.g. the upgrade
   *   request).
   * @return {unknown} May return a promise; errors are logged.
   */
  handleConnection(client: TClient, ...args: unknown[]): unknown;
}

/**
 * Hook called for every client disconnecting from the gateway.
 *
 * @template TClient - Client type of the active WebSocket adapter.
 */
export interface OnGatewayDisconnect<TClient = unknown> {
  /**
   * @param {TClient} client - The disconnected client.
   * @return {unknown} May return a promise; errors are logged.
   */
  handleDisconnect(client: TClient): unknown;
}
