import type { ControllerMapping, HttpAdapter } from "@denorid/core";
import { Hono } from "@hono/hono";
import type { ControllerMappingOptions } from "../core/http/adapter.ts";
import { HonoControllerMapping } from "./controller_mapping.ts";

export class HonoAdapter implements HttpAdapter {
  private readonly app = new Hono();
  private server?: Deno.HttpServer<Deno.NetAddr>;

  /**
   * @inheritdoc
   */
  public listen(port?: number): void {
    this.server ??= Deno.serve({ port: port ?? 3000 }, this.app.fetch);
  }

  /**
   * @inheritdoc
   */
  public async close(): Promise<void> {
    await this.server?.shutdown();

    delete this.server;
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
