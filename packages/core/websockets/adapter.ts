import type { GatewayOptions } from "./gateway_options.ts";

/**
 * A message handler of one gateway method, bound to one connected client.
 */
export interface WsMessageHandler {
  /** Event name, as passed to `@SubscribeMessage()`. */
  readonly event: string;

  /**
   * Runs the gateway method for an incoming message: guards, validation and
   * the method itself, inside a request scope.
   *
   * Resolves with the value the method returned. Adapters deliver it:
   * - `undefined`: nothing is sent.
   * - a `WsResponse` (see `isWsResponse`): sent to the client as event
   *   `response.event` with payload `response.data`.
   * - anything else: sent as reply to the message (acknowledgement).
   *
   * Rejects with a `WsException` when the message failed and no exception
   * filter took care of it. Adapters send `exception.getPayload()` to the
   * client as event `WS_EXCEPTION_EVENT`. When an exception filter handled
   * the error, the promise resolves with the filter's result instead.
   *
   * @param {unknown} data - The message payload.
   * @return {Promise<unknown>} The value to deliver.
   */
  callback(data: unknown): Promise<unknown>;
}

/**
 * Transport behind `@WebSocketGateway()` classes.
 *
 * The application calls the methods in this order:
 * 1. {@link create} once per gateway while the application initializes,
 *    before the HTTP server listens. Gateways with equal options may receive
 *    the same server.
 * 2. {@link bindClientConnect} once per gateway.
 * 3. For every connected client: {@link bindMessageHandlers}, then
 *    {@link bindClientDisconnect}.
 * 4. {@link close} once per distinct server, before the HTTP server closes.
 *
 * @template TServer - Server object, injected into `@WebSocketServer()`
 *   fields and passed to `afterInit`.
 * @template TClient - Client object, passed to `handleConnection`,
 *   `handleDisconnect` and available via `WsContext.client`.
 * @template TOptions - Gateway options the adapter understands.
 */
export interface WebSocketAdapter<
  TServer = unknown,
  TClient = unknown,
  TOptions extends GatewayOptions = GatewayOptions,
> {
  /**
   * Creates the server for a gateway, or returns the existing one when a
   * gateway with the same options (e.g. `path`) was created before.
   *
   * @param {TOptions} options - Options of `@WebSocketGateway()`.
   * @return {TServer | Promise<TServer>} The server.
   */
  create(options: TOptions): TServer | Promise<TServer>;

  /**
   * Registers `callback` for every client connecting to `server`.
   *
   * @param {TServer} server - Server returned by {@link create}.
   * @param {(client: TClient, ...args: unknown[]) => void} callback - Called
   *   with the client and adapter specific arguments (e.g. the upgrade
   *   request).
   * @return {void}
   */
  bindClientConnect(
    server: TServer,
    callback: (client: TClient, ...args: unknown[]) => void,
  ): void;

  /**
   * Registers `callback` to run once `client` disconnects.
   *
   * @param {TClient} client - The connected client.
   * @param {() => void} callback - Called once on disconnect.
   * @return {void}
   */
  bindClientDisconnect(client: TClient, callback: () => void): void;

  /**
   * Routes incoming messages of `client` to `handlers` by event name and
   * delivers their results (see {@link WsMessageHandler.callback}).
   *
   * @param {TClient} client - The connected client.
   * @param {WsMessageHandler[]} handlers - Handlers of one gateway.
   * @return {void}
   */
  bindMessageHandlers(client: TClient, handlers: WsMessageHandler[]): void;

  /**
   * Disconnects every client of `server` and releases its resources. Must not
   * close the HTTP server, which belongs to the HTTP adapter.
   *
   * @param {TServer} server - Server returned by {@link create}.
   * @return {Promise<void>} Resolves once the server is closed.
   */
  close(server: TServer): Promise<void>;
}
