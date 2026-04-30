import type {
  ExecutionContext,
  HttpController,
  HttpRouteFn,
  RequestContext,
} from "@denorid/core";
import type { Type } from "@denorid/injector";
import type { Context } from "@hono/hono";
import { HonoHostArguments } from "./host_arguments.ts";

export class HonoExecutionContext extends HonoHostArguments
  implements ExecutionContext {
  public constructor(
    c: Context,
    ctx: RequestContext,
    private readonly controllerClass: Type<HttpController>,
    private readonly handler: HttpRouteFn,
  ) {
    super(c, ctx);
  }

  /**
   * @inheritdoc
   */
  public getClass<T = HttpController>(): Type<T> {
    return this.controllerClass as Type<T>;
  }

  /**
   * @inheritdoc
   */
  public getHandler<T = HttpRouteFn>(): T {
    return this.handler as T;
  }
}
