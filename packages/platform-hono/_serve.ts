import type { Context, MiddlewareHandler } from "@hono/hono";
import type { BunWebSocketData, BunWebSocketHandler } from "@hono/hono/bun";
import type { WSEvents } from "@hono/hono/ws";
import {
  createAdaptorServer,
  upgradeWebSocket as upgradeNodeWebSocket,
} from "@hono/node-server";
import type { createServer, Server as NodeHttpServer } from "node:http";
import { WebSocketServer } from "ws";

/**
 * Request handler shared by every runtime. The second argument carries the
 * runtime specific bindings that end up as the Hono `c.env`.
 */
export type FetchHandler = (
  request: Request,
  env: object,
) => Response | Promise<Response>;

/**
 * Hono `upgradeWebSocket` helper of one server API: a middleware that
 * upgrades WebSocket requests and passes every other request on to `next()`.
 */
export type UpgradeWebSocket = (
  createEvents: (c: Context) => WSEvents,
) => MiddlewareHandler;

/**
 * Runtime agnostic handle to a running HTTP server.
 */
export interface ServerHandle {
  /**
   * Stops accepting new connections and resolves once the server has stopped.
   *
   * @return {Promise<void>} Resolves when the server has shut down.
   */
  close(): Promise<void>;
  /**
   * Upgrade helper matching the server API. Only set when the server was
   * started with {@linkcode ServeOptions.webSockets}.
   */
  upgradeWebSocket?: UpgradeWebSocket;
}

/**
 * Minimal shape of the `Deno` global needed to serve HTTP.
 */
export interface DenoRuntime {
  /** `Deno.serve`, passing the handler info (`remoteAddr`) as `c.env`. */
  serve?: (
    options: { port: number },
    handler: FetchHandler,
  ) => { shutdown(): Promise<void> };
}

/**
 * Minimal shape of the `Bun` global needed to serve HTTP and files.
 */
export interface BunRuntime {
  /**
   * `Bun.serve`, passing the server (`requestIP(request)`, `upgrade(request)`)
   * as `c.env`.
   */
  serve?: (
    options: {
      port: number;
      fetch: FetchHandler;
      websocket?: BunWebSocketHandler<BunWebSocketData>;
    },
  ) => { stop(): void | Promise<void> };
  /** `Bun.file`, a lazily read file blob. */
  file?: (path: string) => Blob;
}

/**
 * Runtime globals inspected by {@linkcode startServer} and the static files
 * handler.
 */
export interface RuntimeGlobals {
  /** Present when running on Deno. */
  Deno?: DenoRuntime;
  /** Present when running on Bun. */
  Bun?: BunRuntime;
}

/**
 * Runtime specific Hono WebSocket modules, loaded by
 * {@linkcode loadWebSocketModules}. Node.js needs none: its helper comes from
 * `@hono/node-server`.
 */
export interface WebSocketModules {
  /** `upgradeWebSocket` of `@hono/hono/deno`, loaded on Deno. */
  deno?: UpgradeWebSocket;
  /** `upgradeWebSocket` and `websocket` of `@hono/hono/bun`, loaded on Bun. */
  bun?: {
    upgradeWebSocket: UpgradeWebSocket;
    websocket: BunWebSocketHandler<BunWebSocketData>;
  };
}

/**
 * Options of {@linkcode startServer}.
 */
export interface ServeOptions {
  /**
   * Listen on this `node:http` server instead of the native server API of
   * the runtime.
   */
  nodeServer?: NodeHttpServer;
  /**
   * Enables WebSocket upgrades. The returned handle then carries the
   * matching {@linkcode ServerHandle.upgradeWebSocket}.
   */
  webSockets?: WebSocketModules;
}

// `@hono/node-server` is typed against the npm `hono` package, whose
// `Context` is nominally distinct from the one of `jsr:@hono/hono`. The
// helper only reads `c.req` and `c.env`, which both packages share.
const upgradeNodeServerWebSocket =
  upgradeNodeWebSocket as unknown as UpgradeWebSocket;

/**
 * Loads the Hono WebSocket helper of the native server API of the current
 * runtime: `@hono/hono/deno` on Deno, `@hono/hono/bun` on Bun, nothing on
 * Node.js.
 *
 * @param {RuntimeGlobals} [runtime] - Globals used to detect the runtime, defaults to `globalThis`.
 * @return {Promise<WebSocketModules>} The loaded modules.
 */
export async function loadWebSocketModules(
  runtime: RuntimeGlobals = globalThis as RuntimeGlobals,
): Promise<WebSocketModules> {
  // Both modules are platform specific: evaluating them on another runtime
  // throws (`Deno is not defined`, `Bun is not defined`), so they cannot be
  // imported statically.
  if (typeof runtime.Deno?.serve === "function") {
    const { upgradeWebSocket } = await import("@hono/hono/deno");

    return { deno: upgradeWebSocket };
  }

  if (typeof runtime.Bun?.serve === "function") {
    const { upgradeWebSocket, websocket } = await import("@hono/hono/bun");

    return { bun: { upgradeWebSocket, websocket } };
  }

  return {};
}

/**
 * Creates a `node:http` server handling requests with `fetch` through
 * `@hono/node-server`. It does not listen yet.
 *
 * The global `Request` and `Response` stay untouched: by default
 * `@hono/node-server` replaces them with its own classes, and native
 * responses (e.g. from `fetch()`) then fail `instanceof Response`.
 *
 * @param {FetchHandler} fetch - Handler invoked for every incoming request.
 * @return {NodeHttpServer} The server.
 */
export function createNodeServer(fetch: FetchHandler): NodeHttpServer {
  // Without `createServer` option @hono/node-server creates a node:http server.
  return createAdaptorServer({
    fetch,
    overrideGlobalObjects: false,
  }) as NodeHttpServer;
}

/**
 * Starts an HTTP server on the native server API of the current runtime.
 *
 * - Deno: `Deno.serve`, closed via `shutdown()`.
 * - Bun: `Bun.serve`, closed via `stop()`.
 * - Anything else (Node.js), or when `options.nodeServer` is given: a
 *   `node:http` server from `@hono/node-server`, closed via `server.close()`.
 *   WebSocket upgrades are handled with `ws`.
 *
 * @param {FetchHandler} fetch - Handler invoked for every incoming request.
 * @param {number} port - Port to listen on.
 * @param {ServeOptions} [options] - `node:http` server and WebSocket support.
 * @param {RuntimeGlobals} [runtime] - Globals used to detect the runtime, defaults to `globalThis`.
 * @return {ServerHandle} Handle used to stop the server.
 */
export function startServer(
  fetch: FetchHandler,
  port: number,
  options: ServeOptions = {},
  runtime: RuntimeGlobals = globalThis as RuntimeGlobals,
): ServerHandle {
  const { nodeServer, webSockets } = options;

  if (nodeServer === undefined) {
    const deno = runtime.Deno;

    if (typeof deno?.serve === "function") {
      const server = deno.serve({ port }, fetch);

      return {
        close: (): Promise<void> => server.shutdown(),
        upgradeWebSocket: webSockets?.deno,
      };
    }

    const bun = runtime.Bun;

    if (typeof bun?.serve === "function") {
      const server = bun.serve({
        port,
        fetch,
        websocket: webSockets?.bun?.websocket,
      });

      return {
        close: async (): Promise<void> => {
          await server.stop();
        },
        upgradeWebSocket: webSockets?.bun?.upgradeWebSocket,
      };
    }
  }

  return listenNodeServer(
    nodeServer ?? createNodeServer(fetch),
    port,
    fetch,
    webSockets !== undefined,
  );
}

/**
 * Lets `server` listen on `port`, handling WebSocket upgrades with `ws` when
 * `webSockets` is set.
 *
 * @param {NodeHttpServer} server - Server to listen on.
 * @param {number} port - Port to listen on.
 * @param {FetchHandler} fetch - Handler the server was created with.
 * @param {boolean} webSockets - Whether to handle WebSocket upgrades.
 * @return {ServerHandle} Handle used to stop the server.
 */
function listenNodeServer(
  server: NodeHttpServer,
  port: number,
  fetch: FetchHandler,
  webSockets: boolean,
): ServerHandle {
  if (!webSockets) {
    server.listen(port);

    return { close: (): Promise<void> => closeNodeServer(server) };
  }

  const detach = attachWebSocketServer(server, fetch);

  server.listen(port);

  return {
    close: async (): Promise<void> => {
      try {
        await closeNodeServer(server);
      } finally {
        detach();
      }
    },
    upgradeWebSocket: upgradeNodeServerWebSocket,
  };
}

/**
 * Registers the WebSocket upgrade handling of `@hono/node-server` on an
 * existing `server`, backed by a fresh `ws` server.
 *
 * `@hono/node-server` only sets it up on servers it creates itself, so it is
 * handed `server` as the "created" one. The returned function removes the
 * listeners again: the `ws` server is closed together with `server` and
 * cannot be reused when `server` listens again.
 *
 * @param {NodeHttpServer} server - Server to attach to.
 * @param {FetchHandler} fetch - Handler the upgrade requests are passed to.
 * @return {() => void} Removes the upgrade handling from `server`.
 */
function attachWebSocketServer(
  server: NodeHttpServer,
  fetch: FetchHandler,
): () => void {
  const events = ["upgrade", "close"] as const;
  const before = events.map((event) => server.listeners(event));

  createAdaptorServer({
    fetch,
    overrideGlobalObjects: false,
    websocket: { server: new WebSocketServer({ noServer: true }) },
    createServer: (() => server) as unknown as typeof createServer,
  });

  const added = events.map((event, index) => ({
    event,
    listeners: server.listeners(event).filter((listener) =>
      !before[index].includes(listener)
    ),
  }));

  return (): void => {
    for (const { event, listeners } of added) {
      for (const listener of listeners) {
        server.off(event, listener as (...args: unknown[]) => void);
      }
    }
  };
}

/**
 * Closes `server`.
 *
 * @param {NodeHttpServer} server - Server to close.
 * @return {Promise<void>} Resolves once closed, rejects when it was not
 *   running.
 */
function closeNodeServer(server: NodeHttpServer): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  server.close((error?: Error): void => {
    if (error) {
      reject(error);
    } else {
      resolve();
    }
  });

  return promise;
}
