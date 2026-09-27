import type {
  ControllerMapping,
  ControllerMappingOptions,
  HttpAdapter,
} from "@denorid/core";
import { Hono } from "@hono/hono";
import type { Server as NodeHttpServer } from "node:http";
import { createNodeServer, type ServerHandle, startServer } from "./_serve.ts";
import { WebSocketHub } from "./_web_socket_hub.ts";
import { HonoControllerMapping } from "./controller_mapping.ts";
import { WsAdapter } from "./ws_adapter.ts";

/**
 * Directory served for `GET` and `HEAD` requests no controller route matches.
 */
export interface StaticFilesOptions {
  /**
   * Directory to serve, e.g. a Vite `dist` folder. A relative path resolves
   * against the working directory.
   */
  root: string;
  /**
   * File below `root` answered to page requests (`Accept: text/html`) that
   * match neither a route nor a file, e.g. `index.html` for a single-page app.
   */
  fallback?: string;
  /**
   * Directory below `root` whose file names carry content hashes (Vite:
   * `assets`). Its files may be cached for a year; every other file has to be
   * revalidated.
   */
  immutable?: string;
}

/**
 * Decides whether the address `hop` steps away from the app is a trusted
 * proxy. Hop `0` is the socket peer, hop `1` the last address the peer
 * forwarded, and so on.
 */
export type TrustProxyFn = (address: string, hop: number) => boolean;

/**
 * Proxies trusted to report the client address:
 *
 * - `false`: none, the socket peer is the client.
 * - `true`: all, the leftmost forwarded address is the client. Spoofable by
 *   any client, only use it when every connection passes a proxy that
 *   overwrites the header.
 * - `number`: that many hops in front of the app, e.g. `1` for one reverse
 *   proxy.
 * - `string[]`: addresses and CIDR ranges (`10.0.0.0/8`, `::1`) of the
 *   proxies. `loopback`, `linklocal` and `uniquelocal` expand to the matching
 *   IPv4 and IPv6 ranges.
 * - {@linkcode TrustProxyFn}: custom decision per address.
 */
export type TrustProxy = boolean | number | readonly string[] | TrustProxyFn;

/**
 * Controls how `HonoRequestContext.ip` resolves the client address.
 *
 * Starting at the socket peer, the forwarded addresses are walked from right
 * to left while the current address is a trusted proxy. The first untrusted
 * address is the client.
 */
export interface ClientIpOptions {
  /**
   * Proxies trusted to report the client address.
   *
   * @default false
   */
  trustProxy?: TrustProxy;
  /**
   * Header carrying the comma separated forwarded addresses, e.g.
   * `cf-connecting-ip` or `x-real-ip` for proxies that set a single address.
   *
   * @default "x-forwarded-for"
   */
  header?: string;
}

/**
 * Options for {@linkcode HonoAdapter}.
 */
export interface HonoAdapterOptions {
  /**
   * Serve files from a directory for `GET` and `HEAD` requests that no
   * controller route matches. Paths below the application `basePath` are never
   * served from it.
   */
  staticFiles?: StaticFilesOptions;
  /**
   * How the client address of a request is resolved. Without it, forwarding
   * headers are ignored and the socket peer is the client.
   */
  clientIp?: ClientIpOptions;
}

/**
 * {@linkcode HttpAdapter} backed by a {@link https://hono.dev | Hono} app.
 *
 * Serves the app through the native HTTP server of the current runtime:
 * `Deno.serve` on Deno, `Bun.serve` on Bun and `@hono/node-server` on Node.js.
 * After {@linkcode getHttpServer} it serves through a `node:http` server on
 * every runtime.
 *
 * WebSocket gateways use the native {@linkcode WsAdapter} unless the
 * application sets another adapter.
 */
export class HonoAdapter implements HttpAdapter {
  private readonly app: Hono = new Hono();
  private readonly webSockets: WebSocketHub = new WebSocketHub(
    this,
    this.app.fetch,
  );
  private server?: ServerHandle;
  private httpServer?: NodeHttpServer;

  /**
   * @param {HonoAdapterOptions} [options] - Static files and client address resolution.
   */
  public constructor(private readonly options: HonoAdapterOptions = {}) {}

  /**
   * @inheritdoc
   */
  public listen(port?: number): void {
    if (this.server !== undefined) {
      return;
    }

    this.server = startServer(this.webSockets.fetch, port ?? 3000, {
      nodeServer: this.httpServer,
      webSockets: this.webSockets.modules,
    });
    this.webSockets.listen(this.server.upgradeWebSocket);
  }

  /**
   * @inheritdoc
   */
  public async close(): Promise<void> {
    const server = this.server;

    delete this.server;
    this.webSockets.stop();

    await server?.close();
  }

  /**
   * @inheritdoc
   */
  public createControllerMapping(
    opts: ControllerMappingOptions,
  ): ControllerMapping | Promise<ControllerMapping> {
    return new HonoControllerMapping(this.app, opts, this.options);
  }

  /**
   * Creates the native {@linkcode WsAdapter}, used for WebSocket gateways
   * unless the application sets another adapter.
   *
   * @return {WsAdapter} The WebSocket adapter.
   */
  public createWebSocketAdapter(): WsAdapter {
    return new WsAdapter(this);
  }

  /**
   * Switches serving to a `node:http` server (`@hono/node-server`) on every
   * runtime and returns it, e.g. to attach socket.io. Repeated calls return
   * the same server; {@linkcode listen} then listens on it and
   * {@linkcode close} closes it.
   *
   * @return {NodeHttpServer} The `node:http` server.
   * @throws {Error} When the adapter already listens through the native
   *   server API of the runtime.
   */
  public getHttpServer(): NodeHttpServer {
    if (this.httpServer !== undefined) {
      return this.httpServer;
    }

    if (this.server !== undefined) {
      throw new Error(
        "HonoAdapter listens already; call getHttpServer() before listen()",
      );
    }

    this.httpServer = createNodeServer(this.webSockets.fetch);

    return this.httpServer;
  }
}
