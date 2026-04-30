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
  RpcArguments,
} from "./host_arguments.ts";

/**
 * Host arguments for an RPC request context.
 *
 * Implements {@link HostArguments} so it can be passed to {@link ExceptionHandler.handle}.
 * Use {@link switchToRpc} to access the message pattern and data payload.
 */
export class RpcHostArguments implements HostArguments {
  /**
   * @param {Pattern} pattern - The message pattern.
   * @param {unknown} data - The message payload.
   */
  public constructor(
    private readonly pattern: Pattern,
    private readonly data: unknown,
  ) {}

  /**
   * Not available in an RPC context - use {@link switchToRpc} instead.
   *
   * @throws {Error} Always.
   * @return {HttpHostArguments}
   */
  public switchToHttp(): HttpHostArguments {
    throw new ContextNotAvailableException(
      "rpc",
      "switchToHttp",
      "switchToRpc",
    );
  }

  /**
   * Returns the RPC arguments for this request context.
   *
   * @return {RpcArguments}
   */
  public switchToRpc(): RpcArguments {
    return {
      getPattern: () => this.pattern,
      getData: () => this.data,
    };
  }
}

/**
 * Execution context for an RPC handler invocation.
 *
 * Passed to global guards during message dispatch so they can inspect
 * the target controller and handler as well as the RPC arguments.
 */
export class RpcExecutionContext<HandlerMethod = HttpRouteFn>
  extends RpcHostArguments
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
