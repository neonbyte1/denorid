import {
  type InferIfZod,
  type PipeTransform,
  type PipeTransformFn,
  RequestContext,
} from "@denorid/core";
import type { Context, HonoRequest } from "@hono/hono";
import { createClientIpResolver } from "./_client_ip.ts";

/** Resolves the socket peer address, ignoring forwarding headers. */
const resolveSocketIp = createClientIpResolver();

export class HonoRequestContext<Dto = unknown> extends RequestContext<Dto> {
  /**
   * @param {Context} ctx - Hono context of the current request.
   * @param {string} contextId - Identifier of the request scope.
   * @param {Dto} dto - Validated request body.
   * @param {(ctx: Context) => string} [resolveIp] - Resolves the client
   * address; defaults to the socket peer address, ignoring forwarding headers.
   */
  public constructor(
    private readonly ctx: Context,
    contextId: string,
    dto: Dto,
    private readonly resolveIp: (ctx: Context) => string = resolveSocketIp,
  ) {
    super(contextId, dto as InferIfZod<Dto>);
  }

  /**
   * Canonical client address as configured by `ClientIpOptions`, or
   * `"0.0.0.0"` when the socket peer is unknown.
   *
   * @return {string} The client IP address.
   */
  public override get ip(): string {
    return this.resolveIp(this.ctx);
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
