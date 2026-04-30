import {
  ContextNotAvailableException,
  type HostArguments,
  type HttpHostArguments,
  type Pattern,
  type RpcArguments,
} from "@denorid/core";

/**
 * Host arguments for a microservice request context.
 *
 * Implements {@link HostArguments} so it can be passed to {@link ExceptionHandler.handle}.
 * Use {@link switchToRpc} to access the message pattern and data payload.
 */
export class MicroserviceHostArguments implements HostArguments {
  /**
   * @param {Pattern} pattern - The message pattern.
   * @param {unknown} data - The message payload.
   */
  public constructor(
    private readonly pattern: Pattern,
    private readonly data: unknown,
  ) {}

  /**
   * Not available in a microservice context - use {@link switchToRpc} instead.
   *
   * @throws {Error} Always.
   * @return {HttpHostArguments}
   */
  public switchToHttp(): HttpHostArguments {
    throw new ContextNotAvailableException(
      "microservice",
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
