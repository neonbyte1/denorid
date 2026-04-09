import {
  type InferIfZod,
  type PipeTransform,
  type PipeTransformFn,
  RequestContext,
} from "@denorid/core";
import type { Context } from "@hono/hono";

export class HonoRequestContext<Dto = unknown> extends RequestContext<Dto> {
  public constructor(private readonly ctx: Context, dto: Dto) {
    super(dto as InferIfZod<Dto>);
  }

  public override headers(): Record<string, string> {
    return this.ctx.req.header();
  }

  public override header(key: string): string | undefined {
    return this.ctx.req.header(key);
  }

  public override queries(): Record<string, string[]>;
  public override queries(key: string): string[];
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

  public override query(key: string): string | undefined;
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

  public override params(): Record<string, string> {
    return this.ctx.req.param();
  }

  public override param(key: string): string | undefined;
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
