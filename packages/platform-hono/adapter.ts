import type {
  ControllerMapping,
  ControllerMappingOptions,
  HttpAdapter,
} from "@denorid/core";
import { Hono } from "@hono/hono";
import { type ServerHandle, startServer } from "./_serve.ts";
import { HonoControllerMapping } from "./controller_mapping.ts";

/**
 * {@linkcode HttpAdapter} backed by a {@link https://hono.dev | Hono} app.
 *
 * Serves the app through the native HTTP server of the current runtime:
 * `Deno.serve` on Deno, `Bun.serve` on Bun and `@hono/node-server` on Node.js.
 */
export class HonoAdapter implements HttpAdapter {
  private readonly app = new Hono();
  private server?: ServerHandle;

  /**
   * @inheritdoc
   */
  public listen(port?: number): void {
    this.server ??= startServer(this.app.fetch, port ?? 3000);
  }

  /**
   * @inheritdoc
   */
  public async close(): Promise<void> {
    const server = this.server;

    delete this.server;

    await server?.close();
  }

  /**
   * @inheritdoc
   */
  public createControllerMapping(
    opts: ControllerMappingOptions,
  ): ControllerMapping | Promise<ControllerMapping> {
    return new HonoControllerMapping(this.app, opts);
  }
}
