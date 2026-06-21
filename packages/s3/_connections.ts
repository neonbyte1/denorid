import { DEFAULT_S3_CONNECTION_NAME } from "./_constants.ts";
import { DuplicateS3ConnectionNameError } from "./exceptions.ts";
import type { S3ConnectionInfo, S3ModuleOptions } from "./module_options.ts";
import { StorageClient } from "./storage_client.ts";

/**
 * Normalizes {@link S3ModuleOptions} into a fully-instantiated map of
 * {@link StorageClient}s keyed by connection name.
 *
 * `S3ConnectionOptions` (single `connection`) is converted into a single
 * entry registered under {@link DEFAULT_S3_CONNECTION_NAME}; the multi-form
 * `S3ConnectionsOptions` is forwarded as-is. Duplicate names raise
 * {@link DuplicateS3ConnectionNameError} - construction is synchronous so
 * the error surfaces at module-resolution time, before any consumer can
 * hold a stale reference.
 *
 * @param {S3ModuleOptions} options - Module options.
 * @return {Map<string, StorageClient>} Map of name -> live storage client.
 * @throws {DuplicateS3ConnectionNameError} On a repeated connection name.
 */
export function createConnectionMap(
  options: S3ModuleOptions,
): Map<string, StorageClient> {
  const descriptors: S3ConnectionInfo[] = "connections" in options
    ? options.connections
    : [{ name: DEFAULT_S3_CONNECTION_NAME, ...options.connection }];

  const map = new Map<string, StorageClient>();

  for (const { name, ...config } of descriptors) {
    if (map.has(name)) {
      throw new DuplicateS3ConnectionNameError(name);
    }

    map.set(name, new StorageClient(config));
  }

  return map;
}
