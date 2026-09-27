import { Hono } from "@hono/hono";
import type { WSEvents } from "@hono/hono/ws";
import {
  type FetchHandler,
  loadWebSocketModules,
  type RuntimeGlobals,
  type UpgradeWebSocket,
  type WebSocketModules,
} from "./_serve.ts";

/**
 * Creates the Hono WebSocket events of one connection.
 *
 * @param {Request} request - Copy of the upgrade request (URL and headers)
 *   that stays readable after the upgrade.
 * @return {WSEvents} Events of the connection.
 */
export type WebSocketRoute = (request: Request) => WSEvents;

const hubs = new WeakMap<object, WebSocketHub>();

/**
 * Returns the hub created for `owner`.
 *
 * @param {object} owner - Owner passed to the {@linkcode WebSocketHub} constructor.
 * @return {WebSocketHub | undefined} The hub, `undefined` when `owner` has none.
 */
export function getWebSocketHub(owner: object): WebSocketHub | undefined {
  return hubs.get(owner);
}

/**
 * Front of the request handling of a `HonoAdapter`: WebSocket upgrades on
 * registered paths are handled here, every other request goes to the app.
 *
 * Upgrades never pass the app, so its middleware (e.g. CORS) cannot touch the
 * immutable headers of an upgrade response, and plain HTTP requests on a
 * WebSocket path still reach the app's routes.
 */
export class WebSocketHub {
  private readonly routes: Map<string, WebSocketRoute> = new Map();
  private loading?: Promise<WebSocketModules>;
  private loaded?: WebSocketModules;
  private listening: boolean = false;
  private upgradeApp?: Hono<{ Bindings: object }>;

  /**
   * @param {object} owner - Object the hub is registered for, see {@linkcode getWebSocketHub}.
   * @param {FetchHandler} fallback - Handles every request that is no WebSocket upgrade on a registered path.
   * @param {RuntimeGlobals} [runtime] - Globals used to detect the runtime, defaults to `globalThis`.
   */
  public constructor(
    owner: object,
    private readonly fallback: FetchHandler,
    private readonly runtime?: RuntimeGlobals,
  ) {
    hubs.set(owner, this);
  }

  /**
   * Handles a request: WebSocket upgrades on a registered path while
   * listening with WebSocket support, `fallback` otherwise.
   *
   * @param {Request} request - The request.
   * @param {object} env - Runtime bindings, passed on unchanged.
   * @return {Response | Promise<Response>} The response.
   */
  public readonly fetch: FetchHandler = (request, env) =>
    this.upgradeApp !== undefined && request.headers.has("upgrade")
      ? this.upgradeApp.fetch(request, env)
      : this.fallback(request, env);

  /**
   * Modules to start the server with: loaded once a path was registered,
   * `undefined` while none is, so that no WebSocket upgrade handling is set up.
   *
   * @return {WebSocketModules | undefined} The modules.
   */
  public get modules(): WebSocketModules | undefined {
    return this.routes.size > 0 ? this.loaded : undefined;
  }

  /**
   * Loads the WebSocket modules of the runtime and registers `route` for
   * upgrade requests on `path`.
   *
   * @param {string} path - Exact URL path.
   * @param {WebSocketRoute} route - Creates the events of every connection.
   * @return {Promise<void>} Resolves once registered.
   * @throws {Error} When the server is listening already or `path` is taken.
   */
  public async register(path: string, route: WebSocketRoute): Promise<void> {
    this.loaded ??= await (this.loading ??= loadWebSocketModules(
      this.runtime,
    ));

    if (this.listening) {
      throw new Error(
        "WebSocket gateways must be created before the HonoAdapter listens",
      );
    }

    if (this.routes.has(path)) {
      throw new Error(`WebSocket path "${path}" is already in use`);
    }

    this.routes.set(path, route);
  }

  /**
   * Removes the route of `path`; later upgrade requests on it go to the app.
   *
   * @param {string} path - Path passed to {@linkcode register}.
   * @return {void}
   */
  public unregister(path: string): void {
    this.routes.delete(path);
  }

  /**
   * Marks the server as listening.
   *
   * @param {UpgradeWebSocket} [upgradeWebSocket] - Helper of the running
   *   server; without it WebSocket upgrades are not handled.
   * @return {void}
   */
  public listen(upgradeWebSocket?: UpgradeWebSocket): void {
    this.listening = true;
    this.upgradeApp = upgradeWebSocket &&
      this.createUpgradeApp(upgradeWebSocket);
  }

  /**
   * Marks the server as stopped.
   *
   * @return {void}
   */
  public stop(): void {
    this.listening = false;
    delete this.upgradeApp;
  }

  private createUpgradeApp(
    upgradeWebSocket: UpgradeWebSocket,
  ): Hono<{ Bindings: object }> {
    const app = new Hono<{ Bindings: object }>();

    app.get("*", (c, next) => {
      const route = this.routes.get(c.req.path);

      if (route === undefined) {
        return next();
      }

      // Deno closes the upgrade request once upgraded, its headers can no
      // longer be read then.
      const { url, headers } = c.req.raw;

      return upgradeWebSocket(() => route(new Request(url, { headers })))(
        c,
        next,
      );
    });
    app.notFound((c) => this.fallback(c.req.raw, c.env));

    return app;
  }
}
