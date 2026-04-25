import {
  type InferIfZod,
  type PipeTransform,
  type PipeTransformFn,
  RequestContext,
} from "@denorid/core";
import type { Context, HonoRequest } from "@hono/hono";
import { getConnInfo } from "@hono/hono/deno";

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

    const conn = getConnInfo(this.ctx);

    return conn?.remote?.address ?? "0.0.0.0";
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
