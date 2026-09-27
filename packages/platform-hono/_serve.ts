import { serve as serveNode } from "@hono/node-server";

/**
 * Request handler shared by every runtime. The second argument carries the
 * runtime specific bindings that end up as the Hono `c.env`.
 */
export type FetchHandler = (
  request: Request,
  env: object,
) => Response | Promise<Response>;

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
 * Minimal shape of the `Bun` global needed to serve HTTP.
 */
export interface BunRuntime {
  /** `Bun.serve`, passing the server (`requestIP(request)`) as `c.env`. */
  serve?: (
    options: { port: number; fetch: FetchHandler },
  ) => { stop(): void | Promise<void> };
}

/**
 * Runtime globals inspected by {@linkcode startServer}.
 */
export interface RuntimeGlobals {
  /** Present when running on Deno. */
  Deno?: DenoRuntime;
  /** Present when running on Bun. */
  Bun?: BunRuntime;
}

/**
 * Starts an HTTP server on the native server API of the current runtime.
 *
 * - Deno: `Deno.serve`, closed via `shutdown()`.
 * - Bun: `Bun.serve`, closed via `stop()`.
 * - Anything else (Node.js): `serve` from `@hono/node-server`, closed via
 *   `server.close()`.
 *
 * @param {FetchHandler} fetch - Handler invoked for every incoming request.
 * @param {number} port - Port to listen on.
 * @param {RuntimeGlobals} [runtime] - Globals used to detect the runtime, defaults to `globalThis`.
 * @return {ServerHandle} Handle used to stop the server.
 */
export function startServer(
  fetch: FetchHandler,
  port: number,
  runtime: RuntimeGlobals = globalThis as RuntimeGlobals,
): ServerHandle {
  const deno = runtime.Deno;

  if (typeof deno?.serve === "function") {
    const server = deno.serve({ port }, fetch);

    return { close: (): Promise<void> => server.shutdown() };
  }

  const bun = runtime.Bun;

  if (typeof bun?.serve === "function") {
    const server = bun.serve({ port, fetch });

    return {
      close: async (): Promise<void> => {
        await server.stop();
      },
    };
  }

  const server = serveNode({ fetch, port });

  return {
    close: (): Promise<void> => {
      const { promise, resolve, reject } = Promise.withResolvers<void>();

      server.close((error?: Error): void => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });

      return promise;
    },
  };
}
