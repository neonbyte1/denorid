import {
  type InferIfZod,
  type PipeTransform,
  type PipeTransformFn,
  RequestContext,
} from "@denorid/core";
import type { Context, HonoRequest } from "@hono/hono";

/**
 * Superset of the `c.env` bindings passed by the servers `HonoAdapter` starts:
 * the `Deno.serve` handler info (`remoteAddr`), the `Bun.serve` server
 * (`requestIP`) and the `@hono/node-server` bindings (`incoming`).
 */
interface ServeBindings {
  /** Peer address of the connection (Deno). */
  remoteAddr?: { hostname?: string };
  /** Resolves the peer address of the original request (Bun). */
  requestIP?(request: Request): { address: string } | null;
  /** Raw `node:http` request exposing the socket (Node.js). */
  incoming?: { socket?: { remoteAddress?: string } };
}

/**
 * Reads the socket peer address from the runtime specific `c.env` bindings.
 *
 * @param {Context} ctx - Hono context of the current request.
 * @return {string | undefined} The peer address, or `undefined` when unknown.
 */
function getRemoteAddress(ctx: Context): string | undefined {
  // Hono types `c.env` per app; the adapter serves an untyped app, so the shape
  // is only known from the serving runtime and every field is checked below.
  const env = ctx.env as ServeBindings | null | undefined;

  if (env?.remoteAddr) {
    return env.remoteAddr.hostname;
  }

  if (typeof env?.requestIP === "function") {
    return env.requestIP(ctx.req.raw)?.address;
  }

  return env?.incoming?.socket?.remoteAddress;
}

export class HonoRequestContext<Dto = unknown> extends RequestContext<Dto> {
  public constructor(
    private readonly ctx: Context,
    contextId: string,
    dto: Dto,
  ) {
    super(contextId, dto as InferIfZod<Dto>);
  }

  /**
   * @inheritdoc
   */
  public override get ip(): string {
    const cfIp = this.header("cf-connecting-ip");
    if (cfIp) {
      return cfIp;
    }

    const xff = this.header("x-forwarded-for");
    if (xff) {
      const ips = xff.split(",").map((ip) => ip.trim());

      if (ips.length > 0) {
        return ips[0];
      }
    }

    const realIp = this.header("x-real-ip");

    if (realIp) {
      return realIp;
    }

    return getRemoteAddress(this.ctx) ?? "0.0.0.0";
  }

  /**
   * @inheritdoc
   */
  public override getUnderlying<T = HonoRequest>(): T {
    return this.ctx.req as unknown as T;
  }

  /**
   * @inheritdoc
   */
  public override headers(): Record<string, string> {
    return this.ctx.req.header();
  }

  /**
   * @inheritdoc
   */
  public override header(key: string): string | undefined {
    return this.ctx.req.header(key);
  }

  /**
   * @inheritdoc
   */
  public override queries(): Record<string, string[]>;
  /**
   * @inheritdoc
   */
  public override queries(key: string): string[];
  /**
   * @inheritdoc
   */
  public override queries<T>(
    key: string,
    transformer: PipeTransform<T> | PipeTransformFn<T>,
  ): T[];
  public override queries<T>(
    key?: string,
    transformer?: PipeTransform<T> | PipeTransformFn<T>,
  ): string[] | Record<string, string[]> | T[] {
    if (!key) {
      return this.ctx.req.queries();
    }

    const values = this.ctx.req.queries(key) ?? [];

    if (transformer) {
      return values.map((val) =>
        this.transform(val, transformer, { type: "query", data: key })
      ) as T[];
    }

    return values;
  }

  /**
   * @inheritdoc
   */
  public override query(key: string): string | undefined;
  /**
   * @inheritdoc
   */
  public override query<T>(
    key: string,
    transformer: PipeTransform<T> | PipeTransformFn<T>,
  ): T;
  public override query<T>(
    key: string,
    transformer?: PipeTransform<T> | PipeTransformFn<T>,
  ): string | T | undefined {
    const value = this.ctx.req.query(key);

    return transformer
      ? this.transform(value, transformer, { type: "query", data: key })
      : value;
  }

  /**
   * @inheritdoc
   */
  public override params(): Record<string, string> {
    return this.ctx.req.param();
  }

  /**
   * @inheritdoc
   */
  public override param(key: string): string | undefined;
  /**
   * @inheritdoc
   */
  public override param<T>(
    key: string,
    transformer: PipeTransform<T> | PipeTransformFn<T>,
  ): T;
  public override param<T>(
    key: string,
    transformer?: PipeTransform<T> | PipeTransformFn<T>,
  ): string | T | undefined {
    const value = this.ctx.req.param(key);

    return transformer
      ? this.transform(value, transformer, { type: "param", data: key })
      : value;
  }
}
