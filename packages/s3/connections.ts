import {
  type Decorator,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from "@denorid/injector";
import { createConnectionMap } from "./_connections.ts";
import { DEFAULT_S3_CONNECTION_NAME, S3_MODULE_OPTIONS } from "./_constants.ts";
import { S3ConnectionNotFoundError } from "./exceptions.ts";
import type { StorageClient } from "./storage_client.ts";

/**
 * Registry of every {@link StorageClient} declared through the {@link S3Module}.
 *
 * Constructed eagerly during module init from the resolved
 * {@link S3ModuleOptions}; provides keyed access via {@link get} and tears
 * the SDK clients down via `onModuleDestroy` on application shutdown.
 */
@Injectable()
export class StorageConnections implements OnModuleDestroy {
  /** Read-only map of named storage clients, keyed by connection name. */
  @Inject(S3_MODULE_OPTIONS, createConnectionMap)
  public readonly connections!: ReadonlyMap<string, StorageClient>;

  /**
   * Retrieves a {@link StorageClient} by connection name.
   *
   * @param {string} [name] - The connection name. Defaults to the default
   *   connection (`"default"`) when omitted.
   * @return {StorageClient} The registered storage client.
   * @throws {S3ConnectionNotFoundError} When no connection is registered
   *   under `name`.
   */
  public get(name?: string): StorageClient {
    const resolved = name ?? DEFAULT_S3_CONNECTION_NAME;
    const client = this.connections.get(resolved);

    if (!client) {
      throw new S3ConnectionNotFoundError(resolved);
    }

    return client;
  }

  /**
   * @inheritdoc
   *
   * Destroys every registered {@link StorageClient}, releasing keep-alive
   * sockets held by the SDK's HTTP handler.
   */
  public onModuleDestroy(): void {
    for (const client of this.connections.values()) {
      client.destroy();
    }
  }
}

/**
 * Field decorator that injects a {@link StorageClient} resolved from
 * {@link StorageConnections}.
 *
 * Shorthand for `@Inject(StorageConnections, (s) => s.get(name))`.
 *
 * @param {string} [name] - Connection name. Defaults to the default
 *   connection when omitted.
 * @return {Decorator<ClassFieldDecoratorContext>} A class field decorator.
 *
 * @example
 * ```ts
 * @Injectable()
 * class AvatarService {
 *   @InjectStorage()              // default connection
 *   private readonly main!: StorageClient;
 *
 *   @InjectStorage("backup")      // named connection
 *   private readonly backup!: StorageClient;
 * }
 * ```
 */
export const InjectStorage = (
  name?: string,
): Decorator<ClassFieldDecoratorContext> =>
  Inject(StorageConnections, (service) => service.get(name));
