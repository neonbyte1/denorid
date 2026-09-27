import type { HttpApplicationContext } from "@denorid/core";
import {
  isWsResponse,
  type WebSocketAdapter,
  WS_EXCEPTION_EVENT,
  WsException,
  type WsMessageHandler,
} from "@denorid/core/websockets";
import type { Server as NodeHttpServer } from "node:http";
import {
  type Namespace,
  Server,
  type ServerOptions,
  type Socket,
} from "socket.io";
import type { SocketIoGatewayOptions } from "./gateway_options.ts";

/** engine.io path used when neither the gateway nor the adapter sets one. */
const DEFAULT_PATH = "/socket.io";

/** Acknowledgement callback socket.io passes as last event argument. */
type Ack = (...args: unknown[]) => void;

/**
 * WebSocket adapter serving `@WebSocketGateway()` classes through
 * {@link https://socket.io | socket.io}, attached to the `node:http` server of
 * the HTTP adapter.
 *
 * - One socket.io `Server` per distinct `path`; gateways sharing a path share
 *   it, their `namespace` selects `io.of(namespace)`.
 * - Gateway servers are the `Namespace` when a `namespace` is set, the
 *   `Server` otherwise.
 * - Clients are socket.io `Socket`s. The connection hook receives the socket
 *   and its `handshake`.
 * - A value returned by a gateway method is sent as acknowledgement when the
 *   client emitted with one; a `WsResponse` is emitted as event instead.
 * - A `WsException` is emitted as event `exception` with its payload; the
 *   acknowledgement is not called then.
 *
 * @example
 * ```ts
 * import { DenoridFactory } from "@denorid/core";
 * import { HonoAdapter } from "@denorid/platform-hono";
 * import { SocketIoAdapter } from "@denorid/platform-socket-io";
 *
 * const app = await DenoridFactory.create(AppModule, new HonoAdapter());
 * app.useWebSocketAdapter(new SocketIoAdapter(app, { cors: { origin: "*" } }));
 * await app.listen();
 * ```
 */
export class SocketIoAdapter
  implements
    WebSocketAdapter<Server | Namespace, Socket, SocketIoGatewayOptions> {
  /** socket.io servers by normalized engine.io path. */
  private readonly servers: Map<string, Server> = new Map();
  /** Servers that are not closed, with the namespaces of their gateways. */
  private readonly open: Map<Server, Set<Namespace>> = new Map();
  /** The HTTP adapter's server, resolved on the first {@link create}. */
  private httpServer?: NodeHttpServer;

  /**
   * @param {Pick<HttpApplicationContext, "getHttpServer">} app - Provides the
   *   `node:http` server socket.io attaches to, usually the HTTP application
   *   itself. `getHttpServer()` is called on the first {@link create}.
   * @param {Partial<ServerOptions>} [options] - socket.io server options used
   *   for every server; gateway options take precedence.
   */
  public constructor(
    private readonly app: Pick<HttpApplicationContext, "getHttpServer">,
    private readonly options: Partial<ServerOptions> = {},
  ) {}

  /**
   * Returns the socket.io server for the gateway's `path`, creating and
   * attaching it to the HTTP server on first use. Server options of a later
   * gateway on an existing path are ignored.
   *
   * @param {SocketIoGatewayOptions} options - Options of `@WebSocketGateway()`.
   * @return {Server | Namespace} The namespace when `options.namespace` is
   *   set, the server otherwise.
   */
  public create(options: SocketIoGatewayOptions): Server | Namespace {
    const { namespace, ...serverOptions } = options;
    const path: string = options.path ?? this.options.path ?? DEFAULT_PATH;
    // socket.io ignores one trailing slash: `/socket.io/` is `/socket.io`.
    const key: string = path.endsWith("/") ? path.slice(0, -1) : path;
    let server: Server | undefined = this.servers.get(key);

    if (server === undefined) {
      this.httpServer ??= this.app.getHttpServer();
      server = new Server(this.httpServer, {
        ...this.options,
        ...serverOptions,
        path,
      });
      this.servers.set(key, server);
    }

    let namespaces: Set<Namespace> | undefined = this.open.get(server);

    if (namespaces === undefined) {
      namespaces = new Set();
      this.open.set(server, namespaces);
    }

    if (!namespace) {
      namespaces.add(server.sockets);

      return server;
    }

    const nsp: Namespace = server.of(namespace);

    namespaces.add(nsp);

    return nsp;
  }

  /**
   * Calls `callback` with the socket and its `handshake` for every client
   * connecting to `server`.
   *
   * @param {Server | Namespace} server - Server returned by {@link create}.
   * @param {(client: Socket, ...args: unknown[]) => void} callback - Connection
   *   callback.
   * @return {void}
   */
  public bindClientConnect(
    server: Server | Namespace,
    callback: (client: Socket, ...args: unknown[]) => void,
  ): void {
    const nsp: Namespace = server instanceof Server ? server.sockets : server;

    nsp.on("connection", (socket: Socket): void => {
      callback(socket, socket.handshake);
    });
  }

  /**
   * Calls `callback` once `client` disconnects.
   *
   * @param {Socket} client - The connected socket.
   * @param {() => void} callback - Disconnect callback.
   * @return {void}
   */
  public bindClientDisconnect(client: Socket, callback: () => void): void {
    client.once("disconnect", (): void => {
      callback();
    });
  }

  /**
   * Subscribes `client` to the events of `handlers`. The first event argument
   * is the payload; a function as last argument is the acknowledgement.
   *
   * Results: `undefined` sends nothing, a `WsResponse` is emitted as event,
   * anything else is passed to the acknowledgement (dropped without one). A
   * `WsException` is emitted as event `exception` with its payload and the
   * acknowledgement is not called; any other failure (e.g. a `WsResponse`
   * with a reserved socket.io event name) is emitted as an internal server
   * error.
   *
   * @param {Socket} client - The connected socket.
   * @param {WsMessageHandler[]} handlers - Handlers of one gateway.
   * @return {void}
   */
  public bindMessageHandlers(
    client: Socket,
    handlers: WsMessageHandler[],
  ): void {
    for (const handler of handlers) {
      client.on(handler.event, (...args: unknown[]): void => {
        void this.handleMessage(client, handler, args);
      });
    }
  }

  /**
   * Disconnects the clients of the gateway namespaces of `server` and closes
   * its engine.io server, once per socket.io `Server` (closing further
   * namespaces of the same server is a no-op). Only the clients of this node
   * are disconnected, also with a cluster adapter (e.g. Redis). The HTTP
   * server keeps running; socket.io's own `close()` is not used because it
   * closes the HTTP server.
   *
   * @param {Server | Namespace} server - Server returned by {@link create}.
   * @return {Promise<void>} Resolves once the server is closed.
   */
  public async close(server: Server | Namespace): Promise<void> {
    const io: Server = server instanceof Server ? server : server.server;
    const namespaces: Set<Namespace> | undefined = this.open.get(io);

    if (namespaces === undefined) {
      return;
    }

    this.open.delete(io);

    for (const nsp of namespaces) {
      nsp.local.disconnectSockets(true);
      await nsp.adapter.close();
    }

    io.engine.close();
  }

  /**
   * Runs `handler` for one incoming event and delivers its result.
   *
   * @param {Socket} client - The socket that sent the event.
   * @param {WsMessageHandler} handler - Handler of the event.
   * @param {unknown[]} args - Event arguments, the acknowledgement last.
   * @return {Promise<void>} Resolves once the result was delivered.
   */
  private async handleMessage(
    client: Socket,
    handler: WsMessageHandler,
    args: unknown[],
  ): Promise<void> {
    const ack: Ack | undefined = typeof args.at(-1) === "function"
      ? args.pop() as Ack
      : undefined;

    try {
      const result: unknown = await handler.callback(args[0]);

      if (result === undefined) {
        return;
      }

      if (isWsResponse(result)) {
        client.emit(result.event, result.data);
      } else {
        ack?.(result);
      }
    } catch (error) {
      const exception: WsException = error instanceof WsException
        ? error
        : new WsException("Internal server error");

      client.emit(WS_EXCEPTION_EVENT, exception.getPayload());
    }
  }
}
