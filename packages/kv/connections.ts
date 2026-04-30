import { ExceptionHandler, RpcHostArguments } from "@denorid/core";
import { Inject, Injectable } from "@denorid/injector";
import { type ConnectionEntry, createConnectionMap } from "./_connections.ts";
import { DEFAULT_QUEUE_NAME, KV_MODULE_OPTIONS } from "./_constants.ts";
import {
  ConnectionNotEstablishedException,
  ConnectionNotFoundException,
} from "./exceptions.ts";

/**
 * Manages Deno KV connections registered via the module options.
 * Provides access to individual connections by name and controls their lifecycle.
 */
@Injectable()
export class KvConnections {
  /**
   * Map of all registered connection entries, keyed by connection name.
   */
  @Inject(KV_MODULE_OPTIONS, createConnectionMap)
  public readonly connections!: ReadonlyMap<string, ConnectionEntry>;

  @Inject(ExceptionHandler)
  private readonly exceptionHandler!: ExceptionHandler;

  /**
   * Retrieves an open `Deno.Kv` instance by connection name.
   *
   * @param {string} [name] - The connection name. Defaults to the default queue name when omitted.
   * @return {Deno.Kv} The open KV instance.
   * @throws {ConnectionNotFoundException} When no connection is registered under `name`.
   * @throws {ConnectionNotEstablishedException} When the connection has not been opened yet.
   */
  public get(name?: string): Deno.Kv {
    name ??= DEFAULT_QUEUE_NAME;

    const conn = this.connections.get(name);

    if (!conn) {
      throw new ConnectionNotFoundException(name);
    }

    if (!conn.kv) {
      throw new ConnectionNotEstablishedException(name);
    }

    return conn.kv;
  }

  /**
   * Opens all registered KV connections.
   * Errors per connection are forwarded to the exception handler rather than thrown.
   *
   * @return {Promise<void>}
   */
  public async connect(): Promise<void> {
    for (const entry of this.connections.values()) {
      try {
        entry.kv ??= await Deno.openKv(entry.path);
      } catch (err) {
        this.exceptionHandler.handle(
          err,
          new RpcHostArguments("kv:connect", entry.path),
        );
      }
    }
  }

  /**
   * Closes all open KV connections.
   * Errors per connection are forwarded to the exception handler rather than thrown.
   *
   * @return {void}
   */
  public close(): void {
    for (const entry of this.connections.values()) {
      try {
        entry.kv?.close();
        delete entry.kv;
      } catch (err) {
        this.exceptionHandler.handle(
          err,
          new RpcHostArguments("kv:close", entry.path),
        );
      }
    }
  }
}

/**
 * Parameter decorator that injects a `Deno.Kv` instance from {@link KvConnections}.
 *
 * @param {string} [name] - The connection name to inject. Defaults to the default connection when omitted.
 * @return {ReturnType<typeof Inject>} A parameter decorator.
 */
export const InjectKv = (name?: string): ReturnType<typeof Inject> =>
  Inject(KvConnections, (service) => service.get(name));
