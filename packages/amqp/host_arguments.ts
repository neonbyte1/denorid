import {
  ContextNotAvailableException,
  type ExecutionContext,
  type HostArguments,
  type HttpController,
  type HttpHostArguments,
  type HttpRouteFn,
  type Pattern,
  type RpcArguments,
} from "@denorid/core";
import type { Type } from "@denorid/injector";

/**
 * Host arguments for an AMQP message context.
 *
 * Implements {@link HostArguments} so it can be passed to
 * `ExceptionHandler.handle`. Use {@link switchToRpc} to access the message
 * pattern and decoded payload.
 */
export class AmqpHostArguments implements HostArguments {
  /**
   * @param {Pattern} pattern - The routing key, or the exchange/queue name when no routing key is present.
   * @param {unknown} data - The decoded message payload.
   */
  public constructor(
    private readonly pattern: Pattern,
    private readonly data: unknown,
  ) {}

  /**
   * Not available in an AMQP context - use {@link switchToRpc} instead.
   *
   * @throws {ContextNotAvailableException} Always.
   * @return {HttpHostArguments}
   */
  public switchToHttp(): HttpHostArguments {
    throw new ContextNotAvailableException(
      "amqp",
      "switchToHttp",
      "switchToRpc",
    );
  }

  /**
   * Returns the RPC arguments for this message context.
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
 * Execution context handed to guards during AMQP message dispatch.
 *
 * Extends {@link AmqpHostArguments} with access to the consumer class and the
 * handler method so guards can inspect their target.
 */
export class AmqpExecutionContext<HandlerMethod = HttpRouteFn>
  extends AmqpHostArguments
  implements ExecutionContext {
  /**
   * @param HandlerMethod The handler method type.
   *
   * @param {Pattern} pattern - The routing key, or the exchange/queue name when no routing key is present.
   * @param {unknown} data - The decoded message payload.
   * @param {Type} controllerClass - The consumer class owning the handler.
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
