import type {
  ExecutionContext,
  HttpController,
  HttpRouteFn,
  Pattern,
} from "@denorid/core";
import type { Type } from "@denorid/injector";
import { MicroserviceHostArguments } from "./host_arguments.ts";

/**
 * Execution context for a microservice handler invocation.
 *
 * Passed to global guards during message dispatch so they can inspect
 * the target controller and handler as well as the RPC arguments.
 */
export class MicroserviceExecutionContext extends MicroserviceHostArguments
  implements ExecutionContext {
  /**
   * @param {Pattern} pattern - The serialized message pattern.
   * @param {unknown} data - The message payload.
   * @param {Type} controllerClass - The controller class owning the handler.
   * @param {HttpRouteFn} handlerFn - Reference to the handler method.
   */
  public constructor(
    pattern: Pattern,
    data: unknown,
    private readonly controllerClass: Type,
    private readonly handlerFn: HttpRouteFn,
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
  public getHandler(): HttpRouteFn {
    return this.handlerFn;
  }
}
