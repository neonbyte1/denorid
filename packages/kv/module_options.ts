import type { openKv } from "@deno/kv";
import type { InjectionToken, ModuleMetadata } from "@denorid/injector";

/**
 * Options forwarded to `openKv` of the `@deno/kv` package, which opens KV
 * stores on Node.js and Bun (and on Deno without the unstable KV API).
 * The native `Deno.openKv` ignores them.
 *
 * Bun ships a `node:v8` module whose serialization format (JavaScriptCore) is
 * incompatible with V8, so `@deno/kv` refuses to open SQLite or remote stores
 * on Bun unless `encodeV8` and `decodeV8` are provided explicitly, e.g.
 * `{ encodeV8: serialize, decodeV8: deserialize }` from `node:v8` (data is then
 * only readable by Bun) or `makeLimitedV8Serializer()` from `@deno/kv`
 * (supports `string`, `boolean`, `null` and `undefined` values only).
 */
export type KvOpenOptions = NonNullable<Parameters<typeof openKv>[1]>;

/**
 * Describes a single named KV connection.
 */
export interface KvConnectionInfo {
  /** The unique name identifying this connection. */
  name: string;
  /**
   * Location of the KV store.
   *
   * - Deno (native `Deno.openKv`, requires `--unstable-kv` or Deno Deploy):
   *   a file-system path, `":memory:"` for an in-memory store or a KV Connect
   *   URL. An empty string is rejected.
   * - Node.js and Bun (`@deno/kv`): an empty string selects the in-memory
   *   store, an `http(s)://` URL connects to a KV Connect endpoint and any
   *   other value is a SQLite file path (`":memory:"` opens an in-memory SQLite
   *   database). On Bun only the empty string works without custom
   *   serializers, see {@link KvOpenOptions}.
   */
  path: string;
  /** When `true`, this connection is used as the queue listener target. */
  queue?: boolean;
  /** Options forwarded to `openKv` of `@deno/kv`. Ignored by the native `Deno.openKv`. */
  openOptions?: KvOpenOptions;
}

/**
 * Options for configuring a single KV connection by path or inline descriptor.
 */
export interface KvConnectionOptions extends Pick<KvConnectionInfo, "queue"> {
  /** A store location string (see {@link KvConnectionInfo.path}) or a descriptor object with `path` and optional `queue` flag and `openOptions`. */
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
