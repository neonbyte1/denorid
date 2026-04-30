import type { KvConnectionInfo, KvModuleOptions } from "./module_options.ts";

export interface ConnectionEntry {
  /** The file system path to the KV store. */
  path: string;
  /** The opened KV instance for this connection. */
  kv?: Deno.Kv;
  /** If `true`, a queue listener will be created for this instance. */
  queue?: boolean;
  /** Indicates whether the queue listener has been created and is active. */
  listening?: boolean;
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

  for (const { name, path, queue } of connectionOptions) {
    connections.set(name, queue === undefined ? { path } : { path, queue });
  }

  return connections;
}
