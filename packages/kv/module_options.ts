import type { InjectionToken, ModuleMetadata } from "@denorid/injector";

/**
 * Describes a single named KV connection.
 */
export interface KvConnectionInfo {
  /** The unique name identifying this connection. */
  name: string;
  /** File-system path or URL passed to `Deno.openKv`. Use an empty string for the default in-memory store. */
  path: string;
  /** When `true`, this connection is used as the queue listener target. */
  queue?: boolean;
}

/**
 * Options for configuring a single KV connection by path or inline descriptor.
 */
export interface KvConnectionOptions extends Pick<KvConnectionInfo, "queue"> {
  /** A file-system path string or a descriptor object with `path` and optional `queue` flag. */
  connection: string | Omit<KvConnectionInfo, "name">;
}

/**
 * Options for configuring multiple named KV connections.
 */
export interface KvConnectionsOptions {
  /** Array of named connection descriptors. */
  connections: KvConnectionInfo[];
}

/** Union of the two synchronous module configuration shapes. */
export type KvModuleOptions = KvConnectionOptions | KvConnectionsOptions;

interface AsyncOptions<T> extends Pick<ModuleMetadata, "imports"> {
  useFactory: (
    // deno-lint-ignore no-explicit-any
    ...args: any[]
  ) => T | Promise<T>;

  inject?: InjectionToken[];
}

/** Async variant of {@link KvConnectionOptions}, resolved via a factory function. */
export type KvAsyncConnectionOptions = AsyncOptions<KvConnectionOptions>;
/** Async variant of {@link KvConnectionsOptions}, resolved via a factory function. */
export type KvAsyncConnectionsOptions = AsyncOptions<KvConnectionsOptions>;
/** Union of the two asynchronous module configuration shapes. */
export type KvAsyncModuleOptions =
  | KvAsyncConnectionOptions
  | KvAsyncConnectionsOptions;
