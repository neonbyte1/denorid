import type { ModuleMetadata } from "@denorid/injector";
import type { InjectionToken } from "@denorid/injector/common";
import type { AnyRelations, DrizzleConfig } from "drizzle-orm";
import type { DrizzlePgConfig } from "drizzle-orm/pg-core";
import type { ConnectionOptions } from "node:tls";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K>
  : never;

/**
 * Represents the supported drivers for drizzle using this library.
 */
export type DrizzleDrivers =
  | "postgres"
  | "sqlite";

/**
 * @template {DrizzleDrivers} T - The driver type, can be the whole union or one item of it
 */
export interface DrizzleOrmBaseConnectionOptions<
  T extends DrizzleDrivers = DrizzleDrivers,
> {
  /**
   * The connection name, defaults to `"default"` and is only required
   * when dealing with more than one connection.
   */
  name: string;
  type: T;
  /**
   * Optional drizzle configuration (`relations`, `logger`, `cache`, `jit`, ...).
   *
   * drizzle-orm v1 builds the relational query API (`db.query`) only from
   * `relations`, created with `defineRelations`; a `schema` bag is not
   * supported anymore.
   *
   * @example Usage
   * ```ts
   * import { defineRelations } from "drizzle-orm";
   * import * as schema from "./db/schema.ts";
   *
   * const relations = defineRelations(schema);
   *
   * drizzle: { relations, logger: true }
   * ```
   */
  drizzle?: Omit<DrizzleConfig<Record<string, never>, AnyRelations>, "schema">;
}

/**
 * Configuration options for SQLite database connections using Drizzle ORM.
 *
 * Extends the base connection options with SQLite-specific configuration.
 * This interface is used when establishing connections to SQLite or LibSQL databases.
 *
 * @extends DrizzleOrmBaseConnectionOptions<"sqlite">
 *
 * @example Usage
 * ```ts
 * const sqliteOptions: DrizzleOrmSqliteConnectionOptions = {
 *   type: "sqlite",
 *   name: "default",
 *   database: "./local.db",
 *   drizzle: { relations }
 * };
 * ```
 */
export interface DrizzleOrmSqliteConnectionOptions
  extends DrizzleOrmBaseConnectionOptions<"sqlite"> {
  /**
   * The SQLite database file path or LibSQL connection URL.
   *
   * Can be a local file path (e.g., "./data.db"), `:memory:`, or a LibSQL
   * URL such as `file:./data.db` or `libsql://[your-database].turso.io`.
   * A value without a URL scheme is treated as a file path and opened as a
   * `file:` URL.
   *
   * @example Usage
   * ```ts
   * database: "./local.db"
   * database: "libsql://[your-database].turso.io"
   * database: ":memory:" // In-memory database
   * ```
   */
  database: string;
}

/**
 * Native `node-postgres` Pool configuration options.
 *
 * These options are passed directly to the pg.Pool constructor when creating
 * a PostgreSQL connection pool. This interface mirrors the official pg library
 * PoolConfig type to maintain compatibility.
 *
 * @see {@link https://node-postgres.com/apis/pool | node-postgres Pool documentation}
 *
 * @example Usage
 * ```ts
 * const poolOptions: DrizzlePostgresPoolOptions = {
 *   host: "localhost",
 *   port: 5432,
 *   database: "mydb",
 *   user: "postgres",
 *   password: "secret",
 *   max: 20,
 *   idleTimeoutMillis: 30000
 * };
 * ```
 */
export interface DrizzlePostgresPoolOptions {
  /** PostgreSQL user name */
  user?: string;

  /** Database name to connect to */
  database?: string;

  /** User password (can be a function for dynamic retrieval) */
  password?: string | (() => string | Promise<string>);

  /** PostgreSQL server port (default: 5432) */
  port?: number;

  /** PostgreSQL server hostname or IP address */
  host?: string;

  /** Full PostgreSQL connection string (overrides individual options if provided) */
  connectionString?: string;

  /** Enable TCP keep-alive */
  keepAlive?: boolean;

  /** Statement timeout in milliseconds (false to disable) */
  statement_timeout?: false | number;

  /** SSL/TLS configuration (true for default SSL, or custom options) */
  ssl?: boolean | ConnectionOptions;

  /** Query timeout in milliseconds */
  query_timeout?: number;

  /** Lock timeout in milliseconds */
  lock_timeout?: number;

  /** Initial delay for keep-alive probes in milliseconds */
  keepAliveInitialDelayMillis?: number;

  /** Idle in transaction session timeout in milliseconds */
  idle_in_transaction_session_timeout?: number;

  /** Application name reported to PostgreSQL */
  application_name?: string;

  /** Fallback application name if application_name is not set */
  fallback_application_name?: string;

  /** Connection timeout in milliseconds */
  connectionTimeoutMillis?: number;

  /** Command-line options to pass to the PostgreSQL server */
  options?: string;

  /** Client encoding (e.g., "utf8") */
  client_encoding?: string;

  /** Maximum number of clients in the pool */
  max?: number;

  /** Minimum number of clients in the pool */
  min?: number;

  /** Time in milliseconds a client must be idle before being removed from the pool */
  idleTimeoutMillis?: number | undefined | null;

  /** Allow the pool to exit when all clients are idle */
  allowExitOnIdle?: boolean;

  /** Maximum number of times a client can be reused before being destroyed */
  maxUses?: number;

  /** Maximum lifetime of a client in seconds */
  maxLifetimeSeconds?: number;
}

/**
 * Configuration options for PostgreSQL database connections using Drizzle ORM.
 *
 * Extends the base connection options with PostgreSQL-specific configuration.
 * Supports both connection pooling and direct connections.
 *
 * @extends DrizzleOrmBaseConnectionOptions<"postgres">
 *
 * @example Usage
 * ```ts
 * // With connection string and pooling
 * const options: DrizzleOrmPostgresConnectionOptions = {
 *   type: "postgres",
 *   name: "default",
 *   connection: "postgresql://localhost/mydb",
 *   pool: true
 * };
 *
 * // With detailed pool configuration
 * const options: DrizzleOrmPostgresConnectionOptions = {
 *   type: "postgres",
 *   name: "analytics",
 *   connection: {
 *     host: "localhost",
 *     port: 5432,
 *     database: "analytics",
 *     max: 20
 *   },
 *   pool: true
 * };
 * ```
 */
export interface DrizzleOrmPostgresConnectionOptions
  extends DrizzleOrmBaseConnectionOptions<"postgres"> {
  /**
   * PostgreSQL connection configuration.
   *
   * Can be either:
   * - A connection string (e.g., "postgresql://user:pass@localhost/db")
   * - A detailed configuration object with individual connection parameters
   */
  connection: string | DrizzlePostgresPoolOptions;
  /**
   * Whether this package creates the `pg.Pool` itself.
   *
   * drizzle's `node-postgres` driver always connects through a `pg.Pool`, so
   * connections are pooled in both modes and `connection` is used as the pool
   * configuration either way. When `true`, the pool is created from the `pg`
   * package imported by this module, and a missing `pg` install fails with
   * `DrizzleMissingDependencyError`. When `false` or `undefined`, drizzle
   * creates the pool.
   *
   * @default false
   */
  pool?: boolean;
  /**
   * Optional drizzle configuration, including the postgres specific `codecs`.
   *
   * @see {@linkcode DrizzleOrmBaseConnectionOptions.drizzle}
   */
  drizzle?: DrizzlePgConfig<AnyRelations>;
}

/**
 * Union type of all supported Drizzle ORM connection options.
 *
 * This type represents the configuration for any supported database driver.
 * Use this when you need to accept connection options for any database type.
 *
 * @example Usage
 * ```ts
 * function setupDatabase(options: DrizzleOrmConnectionOptions) {
 *   if (options.type === "postgres") {
 *     // PostgreSQL-specific logic
 *   } else if (options.type === "sqlite") {
 *     // SQLite-specific logic
 *   }
 * }
 * ```
 */
export type DrizzleOrmConnectionOptions =
  | DrizzleOrmSqliteConnectionOptions
  | DrizzleOrmPostgresConnectionOptions;

/**
 * Module configuration options for the Drizzle ORM module.
 *
 * Supports two configuration modes:
 * - Single connection: Connection options without a name (uses "default" as name)
 * - Multiple connections: Array of named connection configurations
 *
 * @example Usage
 * ```ts
 * // single connection (name defaults to "default")
 * const singleConfig: DrizzleOrmModuleOptions = {
 *   type: "postgres",
 *   connection: "postgresql://localhost/mydb",
 *   pool: true
 * };
 *
 * // multiple named connections
 * const multiConfig: DrizzleOrmModuleOptions = [
 *   {
 *     type: "postgres",
 *     name: "main",
 *     connection: "postgresql://localhost/main"
 *   },
 *   {
 *     type: "sqlite",
 *     name: "cache",
 *     database: "./cache.db"
 *   }
 * ];
 * ```
 */
export type DrizzleOrmModuleOptions =
  | DistributiveOmit<DrizzleOrmConnectionOptions, "name">
  | DrizzleOrmConnectionOptions[];

/**
 * Module-level settings of {@linkcode DrizzleOrmModule.register}.
 */
export interface DrizzleOrmRegisterOptions {
  /**
   * When `true`, `DrizzleService` can be injected in every module without
   * importing the Drizzle module there.
   *
   * @default false
   */
  global?: boolean;
}

/**
 * Asynchronous module configuration options for dynamic Drizzle ORM setup.
 *
 * Used when connection options need to be determined at runtime, such as
 * loading from environment variables, configuration services, or performing
 * async initialization before establishing database connections.
 *
 * @example Usage
 * ```ts
 * const asyncConfig: DrizzleOrmAsyncModuleOptions = {
 *   imports: [ConfigModule],
 *   inject: [ConfigService],
 *   useFactory: async (config: ConfigService) => {
 *     const dbUrl = await config.get('DATABASE_URL');
 *     return {
 *       type: "postgres",
 *       connection: dbUrl,
 *       pool: true
 *     };
 *   }
 * };
 * ```
 */
export interface DrizzleOrmAsyncModuleOptions
  extends Pick<ModuleMetadata, "imports">, DrizzleOrmRegisterOptions {
  /**
   * Factory function that returns Drizzle ORM module configuration.
   *
   * This function receives injected dependencies as arguments and can perform
   * asynchronous operations to determine the final configuration.
   *
   * @param {...any[]} args - Injected dependencies specified in the inject array
   * @returns Module configuration options or a promise resolving to them
   */
  useFactory: (
    // deno-lint-ignore no-explicit-any
    ...args: any[]
  ) => DrizzleOrmModuleOptions | Promise<DrizzleOrmModuleOptions>;

  /**
   * Optional array of injection tokens for dependencies needed by useFactory.
   *
   * These tokens will be resolved and passed as arguments to the useFactory function
   * in the same order they appear in this array. Tokens that are not global
   * must be exported by a module listed in `imports`.
   *
   * @example
   * ```ts
   * imports: [ConfigModule, LoggerModule],
   * inject: [ConfigService, LoggerService]
   * // useFactory will receive: (config: ConfigService, logger: LoggerService)
   * ```
   */
  inject?: InjectionToken[];
}
