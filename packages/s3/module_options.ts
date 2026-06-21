import type { S3ClientConfig } from "@aws-sdk/client-s3";
import type {
  GenericFunction,
  InjectionToken,
  ModuleMetadata,
  Provider,
} from "@denorid/injector";

export type { S3ClientConfig };

/**
 * A single named S3 connection: every `@aws-sdk/client-s3` configuration
 * field plus a `name` that scopes the resulting {@link StorageClient} in
 * the {@link StorageConnections} registry.
 */
export interface S3ConnectionInfo extends S3ClientConfig {
  /** Unique name identifying this connection within the application. */
  name: string;
}

/**
 * Single-connection module configuration.
 *
 * The connection is always registered under the default name (`"default"`)
 * and is the one returned by `InjectStorage()` without an argument. For a
 * custom name or multiple connections use {@link S3ConnectionsOptions}.
 */
export interface S3ConnectionOptions {
  /** When `true`, registers the S3 module as a global provider. */
  global?: boolean;
  /** SDK config for the default-named connection. */
  connection: Omit<S3ConnectionInfo, "name">;
}

/**
 * Multi-connection module configuration.
 *
 * Each entry's `name` becomes the lookup key passed to `InjectStorage(name)`
 * and to `StorageConnections.get(name)`. Names must be unique.
 */
export interface S3ConnectionsOptions {
  /** When `true`, registers the S3 module as a global provider. */
  global?: boolean;
  /** Named connection descriptors. */
  connections: S3ConnectionInfo[];
}

/** Union of the two synchronous module configuration shapes. */
export type S3ModuleOptions = S3ConnectionOptions | S3ConnectionsOptions;

interface AsyncOptionsBase<T> extends Pick<ModuleMetadata, "imports"> {
  /** When `true`, registers the S3 module as a global provider. */
  global?: boolean;
  /**
   * Factory function producing the resolved options.
   *
   * Injected values listed in {@link inject} are forwarded as positional
   * arguments; declare your factory with concrete parameter types - the
   * framework wraps it through a permissive callable signature so the
   * narrower types are preserved.
   *
   * @return {T | Promise<T>} Resolved configuration (without the `global` flag).
   */
  useFactory: GenericFunction<T | Promise<T>>;
  /** Injection tokens passed as arguments to {@link useFactory}. */
  inject?: InjectionToken[];
  /** Additional providers registered alongside the connections provider. */
  extraProviders?: Provider[];
}

/** Async variant of {@link S3ConnectionOptions}, resolved via a factory. */
export type S3AsyncConnectionOptions = AsyncOptionsBase<
  Omit<S3ConnectionOptions, "global">
>;
/** Async variant of {@link S3ConnectionsOptions}, resolved via a factory. */
export type S3AsyncConnectionsOptions = AsyncOptionsBase<
  Omit<S3ConnectionsOptions, "global">
>;
/** Union of the two asynchronous module configuration shapes. */
export type S3AsyncModuleOptions =
  | S3AsyncConnectionOptions
  | S3AsyncConnectionsOptions;
