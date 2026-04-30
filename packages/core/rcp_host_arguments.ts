import {
  ContextNotAvailableException,
  type ExecutionContext,
  type HttpController,
  type HttpRouteFn,
  type Pattern,
} from "@denorid/core";
import type { Type } from "@denorid/injector/common";
import type {
  HostArguments,
  HttpHostArguments,
  RpcHostArguments,
} from "./host_arguments.ts";

/**
 * Host arguments for a RCP request context.
 *
 * Implements {@link HostArguments} so it can be passed to {@link ExceptionHandler.handle}.
 * Use {@link switchToRpc} to access the message pattern and data payload.
 */
export class RcpHostArguments implements HostArguments {
  /**
   * @param {Pattern} pattern - The message pattern.
   * @param {unknown} data - The message payload.
   */
  public constructor(
    private readonly pattern: Pattern,
    private readonly data: unknown,
  ) {}

  /**
   * Not available in a RCP context - use {@link switchToRpc} instead.
   *
   * @throws {Error} Always.
   * @return {HttpHostArguments}
   */
  public switchToHttp(): HttpHostArguments {
    throw new ContextNotAvailableException(
      "rcp",
      "switchToHttp",
      "switchToRpc",
    );
  }

  /**
   * Returns the RPC arguments for this request context.
   *
   * @return {RpcHostArguments}
   */
  public switchToRpc(): RpcHostArguments {
    return {
      getPattern: () => this.pattern,
      getData: () => this.data,
    };
  }
}

/**
 * Execution context for a RCP handler invocation.
 *
 * Passed to global guards during message dispatch so they can inspect
 * the target controller and handler as well as the RPC arguments.
 */
export class RcpExecutionContext<HandlerMethod = HttpRouteFn>
  extends RcpHostArguments
  implements ExecutionContext {
  /**
   * @param HandlerMethod The handler method type
   *
   * @param {Pattern} pattern - The serialized message pattern.
   * @param {unknown} data - The message payload.
   * @param {Type} controllerClass - The controller class owning the handler.
   * @param {HandlerMethod} handlerFn - Reference to the handler method.
   */
  public constructor(
    pattern: Pattern,
    data: unknown,
    private readonly controllerClass: Type,
    private readonly handlerFn: HandlerMethod,
  ) {
    super(pattern, data);
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
  public getHandler<T = HandlerMethod>(): T {
    return this.handlerFn as unknown as T;
  }
}
