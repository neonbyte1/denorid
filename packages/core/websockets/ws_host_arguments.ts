import type { Type } from "@denorid/injector";
import { ContextNotAvailableException } from "../exceptions/context_not_available.ts";
import type { ExecutionContext } from "../guards/execution_context.ts";
import type {
  HostArguments,
  HttpHostArguments,
  RpcArguments,
  WsArguments,
} from "../host_arguments.ts";
import type {
  HttpController,
  HttpRouteFn,
} from "../http/controller_mapping.ts";

/**
 * Host arguments for a message handled by a WebSocket gateway.
 *
 * Passed to exception filters (`ExceptionHandler.handle`). Use
 * {@link switchToWs} to access the client, the payload and the event name.
 */
export class WsHostArguments implements HostArguments {
  /**
   * @param {string} event - Event name of the message.
   * @param {unknown} data - Message payload, as received.
   * @param {unknown} client - The client that sent the message.
   */
  public constructor(
    private readonly event: string,
    private readonly data: unknown,
    private readonly client: unknown,
  ) {}

  /**
   * Not available in a WebSocket context - use {@link switchToWs} instead.
   *
   * @throws {ContextNotAvailableException} Always.
   * @return {HttpHostArguments}
   */
  public switchToHttp(): HttpHostArguments {
    throw new ContextNotAvailableException("ws", "switchToHttp", "switchToWs");
  }

  /**
   * Not available in a WebSocket context - use {@link switchToWs} instead.
   *
   * @throws {ContextNotAvailableException} Always.
   * @return {RpcArguments}
   */
  public switchToRpc(): RpcArguments {
    throw new ContextNotAvailableException("ws", "switchToRpc", "switchToWs");
  }

  /**
   * Returns the WebSocket arguments of this message.
   *
   * @return {WsArguments} Accessors for client, payload and event name.
   */
  public switchToWs(): WsArguments {
    return {
      getClient: <T>(): T => this.client as T,
      getData: <T>(): T => this.data as T,
      getPattern: (): string => this.event,
    };
  }
}

/**
 * Execution context passed to guards of a WebSocket gateway method.
 *
 * @template HandlerMethod - Type of the gateway method.
 */
export class WsExecutionContext<HandlerMethod = HttpRouteFn>
  extends WsHostArguments
  implements ExecutionContext {
  /**
   * @param {string} event - Event name of the message.
   * @param {unknown} data - Message payload, as received.
   * @param {unknown} client - The client that sent the message.
   * @param {Type} gatewayClass - The gateway class owning the handler.
   * @param {HandlerMethod} handlerFn - Reference to the gateway method.
   */
  public constructor(
    event: string,
    data: unknown,
    client: unknown,
    private readonly gatewayClass: Type,
    private readonly handlerFn: HandlerMethod,
  ) {
    super(event, data, client);
  }

  /**
   * @inheritdoc
   */
  public getClass<T = HttpController>(): Type<T> {
    return this.gatewayClass as Type<T>;
  }

  /**
   * @inheritdoc
   */
  public getHandler<T = HandlerMethod>(): T {
    return this.handlerFn as unknown as T;
  }
}
