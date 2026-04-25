import type { Pattern } from "./pattern.ts";

/**
 * Base class for microservice client implementations.
 * Defines the contract for connecting, closing, and messaging a microservice.
 */
export abstract class ClientProxy {
  /**
   * Establishes connection to the microservice.
   *
   * @return {Promise<void>}
   */
  public abstract connect(): Promise<void>;

  /**
   * Closes the connection to the microservice.
   *
   * @return {Promise<void>}
   */
  public abstract close(): Promise<void>;

  /**
   * Sends a message and awaits a response.
   *
   * @param {Pattern} pattern - Message pattern identifying the handler.
   * @param {unknown} data - Payload to send.
   * @return {Promise<T>}
   */
  public abstract send<T>(pattern: Pattern, data: unknown): Promise<T>;

  /**
   * Emits an event without awaiting a response.
   *
   * @param {Pattern} pattern - Event pattern identifying the handler.
   * @param {unknown} data - Payload to emit.
   * @return {Promise<void>}
   */
  public abstract emit(pattern: Pattern, data: unknown): Promise<void>;
}
