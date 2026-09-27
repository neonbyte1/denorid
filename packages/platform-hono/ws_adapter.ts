import {
  type GatewayOptions,
  type WebSocketAdapter,
  WsException,
  type WsMessageHandler,
} from "@denorid/core";
import type { WSContext, WSEvents } from "@hono/hono/ws";
import { getWebSocketHub, type WebSocketHub } from "./_web_socket_hub.ts";
import {
  exceptionFrame,
  parseMessage,
  resultFrame,
  type WsMessage,
} from "./_ws_protocol.ts";
import type { HonoAdapter } from "./adapter.ts";
import { WsClient } from "./ws_client.ts";
import { WsServer } from "./ws_server.ts";

/**
 * Options of `@WebSocketGateway()` understood by the native
 * {@linkcode WsAdapter}. `namespace` is not supported and throws; use
 * `@denorid/platform-socket-io` for namespaces.
 */
export interface WsGatewayOptions extends GatewayOptions {
  /**
   * Exact URL path the gateway is served on. A missing leading `/` is added.
   *
   * @default "/"
   */
  path?: string;
}

/** Gateways sharing one path. */
interface ServerState {
  server: WsServer;
  clients: Set<WsClient>;
  connectListeners: ((client: WsClient, request: Request) => void)[];
  /** Set while {@linkcode WsAdapter.close} waits for the clients to leave. */
  drained?: PromiseWithResolvers<void>;
}

/** One connected client. */
interface Connection {
  client: WsClient;
  handlers: Map<string, WsMessageHandler>;
  disconnectListeners: (() => void)[];
}

const CLOSE_GOING_AWAY = 1001;

/**
 * Native WebSocket adapter of the {@linkcode HonoAdapter}: serves gateways
 * through the Hono WebSocket helper of the runtime (`Deno.serve`, `Bun.serve`
 * or `node:http` with `ws`). It is the default WebSocket adapter of a
 * {@linkcode HonoAdapter} application.
 *
 * Wire protocol (JSON text frames, compatible with the NestJS `WsAdapter`):
 * - client to server: `{ "event": string, "data"?: unknown, "id"?: string | number }`.
 * - events (`WsResponse` results, `emit`): `{ "event": string, "data": unknown }`.
 * - replies (any other result but `undefined`): `{ "id": id, "data": result }`
 *   when the message had an `id`, the serialized result as is otherwise.
 * - errors: `{ "event": "exception", "data": payload }` plus the `id` of the
 *   message, if any. Unknown events are answered this way only when the
 *   message had an `id`.
 * - invalid JSON, messages without a string `event` and binary frames are
 *   ignored.
 *
 * Gateways with the same path share one {@linkcode WsServer}; their message
 * handlers are merged per client, a later binding of an event replaces the
 * earlier one.
 *
 * @example
 * ```ts
 * const adapter = new HonoAdapter();
 * const app = await DenoridFactory.create(AppModule, adapter);
 *
 * // Optional, this is the default of HonoAdapter applications.
 * app.useWebSocketAdapter(new WsAdapter(adapter));
 * ```
 */
export class WsAdapter
  implements WebSocketAdapter<WsServer, WsClient, WsGatewayOptions> {
  private readonly hub: WebSocketHub;
  private readonly servers: Map<string, ServerState> = new Map();
  private readonly connections: Map<WsClient, Connection> = new Map();

  /**
   * @param {HonoAdapter} adapter - HTTP adapter whose server handles the upgrades.
   * @throws {TypeError} When `adapter` is no {@linkcode HonoAdapter}.
   */
  public constructor(adapter: HonoAdapter) {
    const hub = getWebSocketHub(adapter);

    if (hub === undefined) {
      throw new TypeError("WsAdapter requires a HonoAdapter");
    }

    this.hub = hub;
  }

  /**
   * Returns the server for `options.path`, creating it on first use. Must be
   * called before the {@linkcode HonoAdapter} listens.
   *
   * @param {WsGatewayOptions} [options] - Gateway options.
   * @return {Promise<WsServer>} The server of the path.
   * @throws {Error} When `options.namespace` is set, the adapter listens
   *   already, or another adapter serves the path.
   */
  public async create(options: WsGatewayOptions = {}): Promise<WsServer> {
    if (options.namespace !== undefined) {
      throw new Error(
        '"WsAdapter" does not support namespaces, use "@denorid/platform-socket-io" instead',
      );
    }

    const path = options.path ?? "/";
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const existing = this.servers.get(normalized);

    if (existing !== undefined) {
      return existing.server;
    }

    const clients = new Set<WsClient>();
    const state: ServerState = {
      server: new WsServer(normalized, clients),
      clients,
      connectListeners: [],
    };

    await this.hub.register(
      normalized,
      (request) => this.createEvents(state, request),
    );
    this.servers.set(normalized, state);

    return state.server;
  }

  /**
   * Calls `callback` with the client and its upgrade request for every
   * client connecting to `server`.
   *
   * @param {WsServer} server - Server returned by {@linkcode create}.
   * @param {(client: WsClient, ...args: unknown[]) => void} callback - Called
   *   with the client and the upgrade `Request`.
   * @return {void}
   * @throws {Error} When `server` is not served by this adapter (anymore).
   */
  public bindClientConnect(
    server: WsServer,
    callback: (client: WsClient, ...args: unknown[]) => void,
  ): void {
    const state = this.servers.get(server.path);

    if (state?.server !== server) {
      throw new Error(
        `WsServer on "${server.path}" is not served by this adapter`,
      );
    }

    state.connectListeners.push(callback);
  }

  /**
   * Calls `callback` once `client` disconnected, right away when it is
   * disconnected already.
   *
   * @param {WsClient} client - The client.
   * @param {() => void} callback - Called once on disconnect.
   * @return {void}
   */
  public bindClientDisconnect(client: WsClient, callback: () => void): void {
    const connection = this.connections.get(client);

    if (connection === undefined) {
      callback();
    } else {
      connection.disconnectListeners.push(callback);
    }
  }

  /**
   * Routes the messages of `client` to `handlers` by event name. Handlers
   * bound before for the same event are replaced. Does nothing once the
   * client disconnected.
   *
   * @param {WsClient} client - The client.
   * @param {WsMessageHandler[]} handlers - Handlers of one gateway.
   * @return {void}
   */
  public bindMessageHandlers(
    client: WsClient,
    handlers: WsMessageHandler[],
  ): void {
    const connection = this.connections.get(client);

    if (connection === undefined) {
      return;
    }

    for (const handler of handlers) {
      connection.handlers.set(handler.event, handler);
    }
  }

  /**
   * Stops accepting connections on the path of `server`, closes every client
   * with code `1001` and resolves once all of them disconnected. The HTTP
   * server keeps running.
   *
   * @param {WsServer} server - Server returned by {@linkcode create}.
   * @return {Promise<void>} Resolves once every client disconnected.
   */
  public async close(server: WsServer): Promise<void> {
    const state = this.servers.get(server.path);

    if (state?.server !== server) {
      return;
    }

    this.servers.delete(server.path);
    this.hub.unregister(server.path);

    if (state.clients.size === 0) {
      return;
    }

    state.drained = Promise.withResolvers();

    for (const client of state.clients) {
      client.close(CLOSE_GOING_AWAY, "Server closing");
    }

    await state.drained.promise;
  }

  private createEvents(state: ServerState, request: Request): WSEvents {
    let connection: Connection | undefined;

    return {
      onOpen: (_event, socket) => {
        connection = this.connect(state, socket, request);
      },
      onMessage: (event) => {
        if (connection !== undefined) {
          void this.receive(connection, event.data);
        }
      },
      onClose: () => {
        if (connection !== undefined) {
          this.disconnect(state, connection);
        }
      },
    };
  }

  private connect(
    state: ServerState,
    socket: WSContext,
    request: Request,
  ): Connection | undefined {
    // The server was closed while this connection was being upgraded.
    if (this.servers.get(state.server.path) !== state) {
      socket.close(CLOSE_GOING_AWAY, "Server closing");

      return undefined;
    }

    const client = new WsClient(socket, request);
    const connection: Connection = {
      client,
      handlers: new Map(),
      disconnectListeners: [],
    };

    state.clients.add(client);
    this.connections.set(client, connection);

    for (const listener of state.connectListeners) {
      listener(client, request);
    }

    return connection;
  }

  private disconnect(state: ServerState, connection: Connection): void {
    const { client } = connection;

    state.clients.delete(client);
    this.connections.delete(client);

    // Rooms are left afterwards, so disconnect handlers still see them.
    for (const listener of connection.disconnectListeners) {
      listener();
    }

    for (const room of client.rooms) {
      client.leave(room);
    }

    if (state.clients.size === 0) {
      state.drained?.resolve();
    }
  }

  private async receive(connection: Connection, data: unknown): Promise<void> {
    const message = parseMessage(data);

    if (message === undefined) {
      return;
    }

    let frame: string | undefined;

    try {
      frame = await this.reply(connection, message);
    } catch (error) {
      frame = exceptionFrame(error, message.id);
    }

    if (frame !== undefined) {
      connection.client.send(frame);
    }
  }

  private async reply(
    connection: Connection,
    message: WsMessage,
  ): Promise<string | undefined> {
    const handler = connection.handlers.get(message.event);

    if (handler !== undefined) {
      return resultFrame(await handler.callback(message.data), message.id);
    }

    if (message.id !== undefined) {
      throw new WsException(`Unknown event "${message.event}"`);
    }

    return undefined;
  }
}
