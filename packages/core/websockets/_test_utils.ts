import type { WebSocketAdapter, WsMessageHandler } from "./adapter.ts";
import type { GatewayOptions } from "./gateway_options.ts";

/**
 * Server of the {@link FakeWebSocketAdapter}.
 */
export class FakeServer {
  public readonly connectCallbacks: ((
    client: FakeClient,
    ...args: unknown[]
  ) => void)[] = [];

  /**
   * @param {GatewayOptions} options - Options of the first gateway.
   */
  public constructor(public readonly options: GatewayOptions) {}
}

/**
 * Client of the {@link FakeWebSocketAdapter}.
 */
export class FakeClient {
  public readonly handlers: WsMessageHandler[] = [];
  public readonly disconnectCallbacks: (() => void)[] = [];

  /**
   * @param {string} id - Client id.
   */
  public constructor(public readonly id: string) {}

  /**
   * Runs the handler subscribed to `event`, like an adapter does for an
   * incoming message.
   *
   * @param {string} event - Event name.
   * @param {unknown} data - Payload.
   * @return {Promise<unknown>} Result of `WsMessageHandler.callback`.
   */
  public send(event: string, data: unknown): Promise<unknown> {
    return this.handlers.find((entry) => entry.event === event)!.callback(
      data,
    );
  }
}

/**
 * In-memory {@link WebSocketAdapter}: one {@link FakeServer} per path.
 */
export class FakeWebSocketAdapter
  implements WebSocketAdapter<FakeServer, FakeClient> {
  public readonly servers: Map<string, FakeServer> = new Map();
  public readonly closed: FakeServer[] = [];

  /**
   * @inheritdoc
   */
  public create(options: GatewayOptions): FakeServer {
    const path = options.path ?? "/";
    let server = this.servers.get(path);

    if (!server) {
      server = new FakeServer(options);
      this.servers.set(path, server);
    }

    return server;
  }

  /**
   * @inheritdoc
   */
  public bindClientConnect(
    server: FakeServer,
    callback: (client: FakeClient, ...args: unknown[]) => void,
  ): void {
    server.connectCallbacks.push(callback);
  }

  /**
   * @inheritdoc
   */
  public bindClientDisconnect(client: FakeClient, callback: () => void): void {
    client.disconnectCallbacks.push(callback);
  }

  /**
   * @inheritdoc
   */
  public bindMessageHandlers(
    client: FakeClient,
    handlers: WsMessageHandler[],
  ): void {
    client.handlers.push(...handlers);
  }

  /**
   * @inheritdoc
   */
  public close(server: FakeServer): Promise<void> {
    this.closed.push(server);
    return Promise.resolve();
  }

  /**
   * Connects `client` to the server of `path`.
   *
   * @param {string} path - Server path.
   * @param {FakeClient} client - The connecting client.
   * @param {...unknown[]} args - Adapter specific connect arguments.
   * @return {void}
   */
  public connect(path: string, client: FakeClient, ...args: unknown[]): void {
    for (const callback of this.servers.get(path)!.connectCallbacks) {
      callback(client, ...args);
    }
  }

  /**
   * Disconnects `client`.
   *
   * @param {FakeClient} client - The disconnecting client.
   * @return {void}
   */
  public disconnect(client: FakeClient): void {
    for (const callback of client.disconnectCallbacks) {
      callback();
    }
  }
}
