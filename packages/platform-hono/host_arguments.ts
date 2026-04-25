import type { HttpHostArguments, RpcHostArguments } from "@denorid/core";
import {
  ContextNotAvailableException,
  type HostArguments,
  type RequestContext,
} from "@denorid/core";
import type { Context } from "@hono/hono";

export class HonoHostArguments implements HostArguments {
  public constructor(
    private readonly c: Context,
    private readonly ctx: RequestContext,
  ) {}

  public switchToHttp(): HttpHostArguments {
    return {
      getRequest: () => this.ctx,
      getResponse: <T>() => this.c as T,
    };
  }

  public switchToRpc(): RpcHostArguments {
    throw new ContextNotAvailableException(
      "HTTP",
      "switchToRpc",
      "switchToHttp",
    );
  }
}
