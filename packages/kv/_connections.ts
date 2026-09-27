import type { Kv } from "@deno/kv";
import type {
  KvConnectionInfo,
  KvModuleOptions,
  KvOpenOptions,
} from "./module_options.ts";

export interface ConnectionEntry {
  /** The location of the KV store (file path, in-memory marker or KV Connect URL). */
  path: string;
  /** Options forwarded to `openKv` of `@deno/kv`. Ignored by the native `Deno.openKv`. */
  openOptions?: KvOpenOptions;
  /** The opened KV instance for this connection. */
  kv?: Kv;
  /** If `true`, a queue listener will be created for this instance. */
  queue?: boolean;
  /** Indicates whether the queue listener has been created and is active. */
  listening?: boolean;
}

/**
 * Minimal view of the `Deno` namespace needed to open a native KV store.
 */
interface DenoKvNamespace {
  openKv?: (path: string) => Promise<unknown>;
}

/**
 * Minimal view of the global scope used to detect the native Deno KV API.
 */
export interface KvRuntimeScope {
  Deno?: DenoKvNamespace;
}

export function createConnectionMap(
  options: KvModuleOptions,
): Map<string, ConnectionEntry> {
  const connections = new Map<string, ConnectionEntry>();
  const connectionOptions = "connections" in options ? options.connections : [
    typeof options.connection === "string"
      ? {
        name: "default",
        path: options.connection,
        queue: options.queue,
      } satisfies KvConnectionInfo
      : {
        name: "default",
        queue: options.queue,
        ...options.connection,
      } satisfies KvConnectionInfo,
  ];

  for (const { name, path, queue, openOptions } of connectionOptions) {
    const entry: ConnectionEntry = { path };

    if (queue !== undefined) {
      entry.queue = queue;
    }

    if (openOptions !== undefined) {
      entry.openOptions = openOptions;
    }

    connections.set(name, entry);
  }

  return connections;
}

/**
 * Opens a KV store for the current runtime.
 *
 * Uses the native `Deno.openKv` when the global scope exposes it (Deno with
 * `--unstable-kv` or Deno Deploy), `openOptions` are ignored in that case.
 * Otherwise (Node.js, Bun or Deno without the unstable KV API) the `@deno/kv`
 * package is imported lazily and its `openKv` receives `path` and `openOptions`.
 *
 * @param {string} path - The location of the KV store.
 * @param {KvOpenOptions} [openOptions] - Options forwarded to `openKv` of `@deno/kv`.
 * @param {KvRuntimeScope} [scope] - The global scope inspected for the native API. Defaults to `globalThis`.
 * @return {Promise<Kv>} The opened KV store.
 */
export async function openKv(
  path: string,
  openOptions?: KvOpenOptions,
  scope: KvRuntimeScope = globalThis as KvRuntimeScope,
): Promise<Kv> {
  const deno = scope.Deno;

  if (typeof deno?.openKv === "function") {
    // `Deno.Kv` is not assignable to `Kv` only because `Deno.KvKeyPart` also
    // allows `symbol`; both describe the same runtime API.
    return await deno.openKv(path) as Kv;
  }

  // Imported lazily so Deno with the native KV API never loads the npm
  // package (and its native SQLite addon).
  const { openKv: openNpmKv } = await import("@deno/kv");

  return await openNpmKv(path, openOptions);
}
