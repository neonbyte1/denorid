import type { Kv } from "@deno/kv";
import { ExceptionHandler, RpcHostArguments } from "@denorid/core";
import { Inject, Injectable } from "@denorid/injector";
import {
  type ConnectionEntry,
  createConnectionMap,
  openKv,
} from "./_connections.ts";
import { DEFAULT_QUEUE_NAME, KV_MODULE_OPTIONS } from "./_constants.ts";
import {
  ConnectionNotEstablishedException,
  ConnectionNotFoundException,
} from "./exceptions.ts";

/**
 * Manages the KV connections registered via the module options.
 * Provides access to individual connections by name and controls their lifecycle.
 *
 * On Deno the native `Deno.openKv` opens the stores (requires `--unstable-kv`
 * or Deno Deploy), on Node.js and Bun the `@deno/kv` package is used.
 *
 * The injector disposes the instance it created after every shutdown hook
 * ran, which closes the stores. Providers can therefore still use their `Kv`
 * in `onModuleDestroy` and `onApplicationShutdown`.
 */
@Injectable()
export class KvConnections implements Disposable {
  /**
   * Map of all registered connection entries, keyed by connection name.
   */
  @Inject(KV_MODULE_OPTIONS, createConnectionMap)
  public readonly connections!: ReadonlyMap<string, ConnectionEntry>;

  @Inject(ExceptionHandler)
  private readonly exceptionHandler!: ExceptionHandler;

  /**
   * Retrieves an open KV instance by connection name.
   *
   * On Deno the instance is a native `Deno.Kv`; cast it
   * (`kv as unknown as Deno.Kv`) to reach Deno-only members such as
   * `commitVersionstamp`.
   *
   * @param {string} [name] - The connection name. Defaults to the default queue name when omitted.
   * @return {Kv} The open KV instance.
   * @throws {ConnectionNotFoundException} When no connection is registered under `name`.
   * @throws {ConnectionNotEstablishedException} When the connection has not been opened yet.
   */
  public get(name?: string): Kv {
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
   * Opens all registered KV connections that are not open yet.
   * Uses the native `Deno.openKv` when available, otherwise `openKv` of
   * `@deno/kv` with the connection's `openOptions`.
   * Errors per connection are forwarded to the exception handler rather than thrown.
   *
   * @return {Promise<void>}
   */
  public async connect(): Promise<void> {
    for (const entry of this.connections.values()) {
      try {
        entry.kv ??= await openKv(entry.path, entry.openOptions);
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

  /**
   * Closes all open KV connections, see {@link KvConnections.close}.
   *
   * @return {void}
   */
  public [Symbol.dispose](): void {
    this.close();
  }
}

/**
 * Parameter decorator that injects a {@link Kv} instance from {@link KvConnections}.
 *
 * @param {string} [name] - The connection name to inject. Defaults to the default connection when omitted.
 * @return {ReturnType<typeof Inject>} A parameter decorator.
 */
export const InjectKv = (name?: string): ReturnType<typeof Inject> =>
  Inject(KvConnections, (service) => service.get(name));
