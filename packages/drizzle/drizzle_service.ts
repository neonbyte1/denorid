import {
  type GenericFunction,
  Inject,
  Injectable,
  type OnModuleInit,
  type Type,
} from "@denorid/injector";
import type { AnyRelations, EmptyRelations } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  DRIVER_PACKAGES,
  DRIZZLE_CONNECTION_OPTIONS,
  MODULE_OPTIONS,
} from "./_internal.ts";
import {
  DrizzleConnectionNotFoundError,
  DrizzleFactoryNotFoundError,
  DrizzleMissingDependencyError,
} from "./errors.ts";
import type {
  DrizzleDrivers,
  DrizzleOrmBaseConnectionOptions,
  DrizzleOrmModuleOptions,
  DrizzleOrmPostgresConnectionOptions,
  DrizzleOrmSqliteConnectionOptions,
  DrizzlePostgresPoolOptions,
} from "./module_options.ts";

/**
 * Matches a leading URL scheme (at least two characters, so Windows drive
 * letters such as `C:` are not mistaken for one), using the scheme grammar of
 * the libsql client.
 */
const URL_SCHEME = /^[a-z][a-z.+-]+:/i;

/**
 * Drizzle database instance as kept in the connection registry. drizzle
 * exposes the driver client it queries through as `$client`: a `pg.Pool` for
 * postgres, a libsql `Client` for sqlite.
 */
interface DrizzleConnection {
  readonly $client: { end(): Promise<void> } | { close(): void };
}

/**
 * The `drizzle()` factory exported by a driver package.
 */
type DrizzleFactory = GenericFunction<DrizzleConnection>;

/**
 * Type representing a bag of Drizzle ORM table definitions, usually the
 * namespace import of your schema module.
 *
 * With drizzle-orm v1 the schema bag is no longer passed to drizzle directly.
 * Hand it to `defineRelations` and register the resulting relations through
 * the `drizzle.relations` connection option; the relations type is what
 * {@linkcode DrizzleService.pg} / {@linkcode DrizzleService.sqlite} take as
 * type argument.
 *
 * @example Define your schema in a file (e.g., schema.ts)
 * ```ts
 * import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";
 *
 * export const users = pgTable("users", {
 *   id: serial("id").primaryKey(),
 *   name: text("name").notNull(),
 * });
 *
 * export const posts = pgTable("posts", {
 *   id: serial("id").primaryKey(),
 *   authorId: integer("author_id").references(() => users.id),
 * });
 * ```
 *
 * @example Define the relations (e.g., relations.ts)
 * ```ts
 * import { defineRelations } from "drizzle-orm";
 * import * as schema from "./schema.ts";
 *
 * export const relations = defineRelations(schema, (r) => ({
 *   users: {
 *     posts: r.many.posts(),
 *   },
 *   posts: {
 *     author: r.one.users({
 *       from: r.posts.authorId,
 *       to: r.users.id,
 *     }),
 *   },
 * }));
 * ```
 *
 * @example Register the relations and query through them
 * ```ts
 * import { relations } from "./relations.ts";
 *
 * DrizzleOrmModule.register({
 *   type: "postgres",
 *   connection: "postgresql://localhost/mydb",
 *   drizzle: { relations },
 * });
 *
 * const db = drizzle.pg<typeof relations>();
 * await db.query.users.findMany({ with: { posts: true } });
 * ```
 */
// deno-lint-ignore no-explicit-any
export type DrizzleSchema = Record<string, any>;

/**
 * Interface to control error handling behavior when accessing database connections.
 *
 * This interface allows you to specify whether connection retrieval methods should
 * throw an error or return undefined when a connection cannot be found. By default,
 * attempting to access a non-existent connection throws a `DrizzleConnectionNotFoundError`.
 * Setting `noThrow: true` changes this behavior to return `undefined` instead.
 *
 * The generic type parameter enables TypeScript to correctly infer the return type
 * of connection methods based on the `noThrow` value:
 * - When `noThrow: false` (or undefined), methods return the database instance
 * - When `noThrow: true`, methods return the database instance or undefined
 *
 * @template T - The boolean literal type for the `noThrow` property
 *
 * @example Default behavior - throws error if connection not found
 * ```ts
 * const db = drizzle.pg(); // Returns: NodePgDatabase
 * // Throws DrizzleConnectionNotFoundError if "default" connection doesn't exist
 * ```
 *
 * @example With noThrow disabled explicitly - throws error
 * ```ts
 * const db = drizzle.pg({ noThrow: false }); // Returns: NodePgDatabase
 * // Throws DrizzleConnectionNotFoundError if not found
 * ```
 *
 * @example With noThrow enabled - returns undefined instead of throwing
 * ```ts
 * const db = drizzle.pg({ noThrow: true }); // Returns: NodePgDatabase | undefined
 *
 * if (db) {
 *   await db.select().from(users);
 * } else {
 *   console.log('Connection not available');
 * }
 * ```
 *
 * @example Named connection with noThrow
 * ```ts
 * const analyticsDb = drizzle.pg('analytics', { noThrow: true });
 *
 * if (!analyticsDb) {
 *   console.warn('Analytics database not configured');
 *   return;
 * }
 *
 * const results = await analyticsDb.select().from(events);
 * ```
 *
 * @example Type-safe conditional handling
 * ```ts
 * function getDatabase(
 *   drizzle: DrizzleService,
 *   options?: NoThrowOption<true>
 * ): NodePgDatabase | undefined;
 * function getDatabase(
 *   drizzle: DrizzleService,
 *   options?: NoThrowOption<false>
 * ): NodePgDatabase;
 * function getDatabase(
 *   drizzle: DrizzleService,
 *   options?: Partial<NoThrowOption>
 * ) {
 *   return drizzle.pg(options);
 * }
 * ```
 *
 * @example Graceful degradation pattern
 * ```ts
 * const cacheDb = drizzle.sqlite('cache', { noThrow: true });
 *
 * async function getCachedData(key: string) {
 *   if (cacheDb) {
 *     // Try cache first
 *     const cached = await cacheDb.select()
 *       .from(cache)
 *       .where(eq(cache.key, key));
 *     if (cached.length > 0) return cached[0].value;
 *   }
 *
 *   // Fall back to primary database or API
 *   return fetchFromPrimarySource(key);
 * }
 * ```
 *
 * @example Using in optional feature initialization
 * ```ts
 * export class AppService {
 *   private analyticsDb?: DrizzlePgDatabase;
 *
 *   constructor(private drizzle: DrizzleService) {
 *     // Analytics is optional, don't fail startup if not configured
 *     this.analyticsDb = this.drizzle.pg('analytics', { noThrow: true });
 *
 *     if (this.analyticsDb) {
 *       console.log('Analytics enabled');
 *     } else {
 *       console.log('Analytics disabled');
 *     }
 *   }
 *
 *   async trackEvent(event: string) {
 *     if (this.analyticsDb) {
 *       await this.analyticsDb.insert(events).values({ event });
 *     }
 *   }
 * }
 * ```
 */
export interface NoThrowOption<T extends boolean = boolean> {
  /**
   * Controls whether to throw an error when a connection is not found.
   *
   * - `false` or `undefined` (default): Throws `DrizzleConnectionNotFoundError`
   * - `true`: Returns `undefined` instead of throwing
   *
   * @default false
   *
   * @example Usage
   * ```ts
   * // Throws on error
   * { noThrow: false }
   *
   * // Returns undefined on error
   * { noThrow: true }
   * ```
   */
  noThrow: T;
}

/**
 * Non-empty tuple of enum values for a Drizzle `text({ enum })` column.
 *
 * Bridges a Zod enum's `.options` (typed as `T[]`) to the non-empty tuple
 * (`[T, ...T[]]`) that `text({ enum })` requires, while preserving the literal
 * union in the column type:
 *
 * ```ts
 * import type { DrizzleEnum } from "@denorid/drizzle";
 * import { z } from "zod";
 *
 * const ProjectType = z.enum(["internal", "external"]);
 * type ProjectType = z.infer<typeof ProjectType>;
 *
 * text({ enum: ProjectType.options as DrizzleEnum<ProjectType> })
 * ```
 *
 * Import it with `import type` so it stays erased: schema modules are executed
 * by drizzle-kit and must not pull in this package's runtime graph.
 */
export type DrizzleEnum<T extends string = string> = [T, ...T[]];

/**
 * Type alias for a Drizzle ORM PostgreSQL database instance.
 *
 * This represents a database connection created using the node-postgres driver
 * with Drizzle ORM. It provides the full Drizzle query builder API for PostgreSQL,
 * including methods for select, insert, update, delete, and transaction operations.
 *
 * Use this type when:
 * - Injecting or passing PostgreSQL database instances
 * - Typing return values from connection methods
 * - Defining service dependencies
 *
 * @template TRelations - Relations created with `defineRelations`, enables the
 *   typed relational query API (`db.query`); defaults to no relations
 *
 * @see {@link https://orm.drizzle.team/docs/get-started-postgresql | Drizzle PostgreSQL Documentation}
 *
 * @example Using in a service with dependency injection with typed relations
 * ```ts
 * import { relations } from "./db/relations.ts";
 *
 * export class UserService {
 *   @Inject(DrizzleService)
 *   private readonly drizzle!: DrizzleService;
 *
 *   private get db(): DrizzlePgDatabase<typeof relations> {
 *     return this.drizzle.pg<typeof relations>();
 *   }
 *
 *   public async findUsers(): Promise<User[]> {
 *     return this.db.query.users.findMany();
 *   }
 * }
 * ```
 *
 * @example Using the query builder
 * ```ts
 * import * as schema from "./db/schema.ts";
 *
 * function queryUsers(db: DrizzlePgDatabase) {
 *   return db.select().from(schema.users);
 * }
 * ```
 */
export type DrizzlePgDatabase<
  TRelations extends AnyRelations = EmptyRelations,
> = NodePgDatabase<TRelations>;

/**
 * Type alias for a Drizzle ORM SQLite/LibSQL database instance.
 *
 * This represents a database connection created using the LibSQL driver
 * with Drizzle ORM. LibSQL is a fork of SQLite that supports both local
 * SQLite files and remote connections (e.g., Turso). It provides the full
 * Drizzle query builder API for SQLite-compatible databases.
 *
 * Use this type when:
 * - Working with SQLite or LibSQL database instances
 * - Typing local or cloud SQLite connections
 * - Defining service methods that operate on SQLite databases
 *
 * @template TRelations - Relations created with `defineRelations`, enables the
 *   typed relational query API (`db.query`); defaults to no relations
 *
 * @see {@link https://orm.drizzle.team/docs/get-started-sqlite | Drizzle SQLite Documentation}
 * @see {@link https://docs.turso.tech/libsql | LibSQL Documentation}
 *
 * @example Using in a service
 * ```ts
 * export class CacheService {
 *   constructor(
 *     @Inject(DrizzleService) private drizzle: DrizzleService
 *   ) {}
 *
 *   async getCachedValue(key: string): Promise<string | null> {
 *     const db: DrizzleSqliteDatabase = this.drizzle.sqlite('cache');
 *     const result = await db.select()
 *       .from(cache)
 *       .where(eq(cache.key, key))
 *       .limit(1);
 *
 *     return result[0]?.value ?? null;
 *   }
 * }
 * ```
 *
 * @example With typed relations
 * ```ts
 * import { relations } from "./relations.ts";
 *
 * type MyCacheDb = DrizzleSqliteDatabase<typeof relations>;
 *
 * async function findEntries(db: MyCacheDb) {
 *   return db.query.cache.findMany();
 * }
 * ```
 *
 * @example Local SQLite file
 * ```ts
 * const db: DrizzleSqliteDatabase = drizzle.sqlite('local');
 * await db.insert(tasks).values({ title: 'Todo', completed: false });
 * ```
 *
 * @example Remote LibSQL (Turso) connection
 * ```ts
 * const db: DrizzleSqliteDatabase = drizzle.sqlite('remote');
 * const users = await db.select().from(schema.users);
 * ```
 */
export type DrizzleSqliteDatabase<
  TRelations extends AnyRelations = EmptyRelations,
> = LibSQLDatabase<TRelations>;

/**
 * Core service for managing and accessing Drizzle ORM database connections.
 *
 * Connections are opened in {@linkcode DrizzleService.onModuleInit} and
 * released when the service is disposed (`InjectorContext.close()` disposes it
 * after every shutdown hook ran), so other providers can still query in their
 * `onModuleDestroy` / `onApplicationShutdown` hooks.
 *
 * @implements {OnModuleInit}
 * @implements {AsyncDisposable}
 *
 * @example Basic injection and usage
 * ```ts
 * \@Injectable()
 * export class UserService {
 *   \@Inject(DrizzleService)
 *   private readonly drizzle!: DrizzleService;
 *
 *   public async findAll() {
 *     const db = this.drizzle.pg();
 *
 *     return db.select().from(users);
 *   }
 * }
 * ```
 *
 * @example Using named connections
 * ```ts
 * \@Injectable()
 * export class DataService {
 *   \@Inject(DrizzleService)
 *   private readonly drizzle!: DrizzleService;
 *
 *   public async getMainData() {
 *     const mainDb = this.drizzle.pg("main");
 *     return mainDb.select().from(data);
 *   }
 *
 *   public async getAnalytics() {
 *     const analyticsDb = this.drizzle.pg("analytics");
 *     return analyticsDb.select().from(events);
 *   }
 * }
 * ```
 *
 * @example With typed relations
 * ```ts
 * import { relations } from "./relations.ts";
 *
 * \@Injectable()
 * export class ProductService {
 *   \@Inject(DrizzleService)
 *   private readonly drizzle!: DrizzleService;
 *
 *   public async getProducts() {
 *     const db = this.drizzle.pg<typeof relations>();
 *
 *     return db.query.products.findMany();
 *   }
 * }
 * ```
 *
 * @example Using SQLite connections
 * ```ts
 * \@Injectable()
 * export class CacheService {
 *   \@Inject(DrizzleService)
 *   private readonly drizzle!: DrizzleService;
 *
 *   public async getCached(key: string) {
 *     const db = this.drizzle.sqlite("cache");
 *     const result = await db.select()
 *       .from(cache)
 *       .where(eq(cache.key, key));
 *     return result[0]?.value;
 *   }
 * }
 * ```
 *
 * @example Error handling with noThrow
 * ```ts
 * \@Injectable()
 * export class OptionalFeatureService {
 *   \@Inject(DrizzleService)
 *   private readonly drizzle!: DrizzleService;
 *
 *   public async trackEvent(event: string) {
 *     const analyticsDb = this.drizzle.pg("analytics", { noThrow: true });
 *
 *     if (analyticsDb) {
 *       await analyticsDb.insert(events).values({ event });
 *     }
 *   }
 * }
 * ```
 *
 * @example Multiple database types in one service
 * ```ts
 * \@Injectable()
 * export class HybridService {
 *   \@Inject(DrizzleService)
 *   private readonly drizzle!: DrizzleService;
 *
 *   public async getUser(id: number) {
 *     const pgDb = this.drizzle.pg("main");
 *     return pgDb.select()
 *       .from(users)
 *       .where(eq(users.id, id));
 *   }
 *
 *   public async getCachedSession(token: string) {
 *     const sqliteDb = this.drizzle.sqlite("cache");
 *     return sqliteDb.select()
 *       .from(sessions)
 *       .where(eq(sessions.token, token));
 *   }
 * }
 * ```
 */
@Injectable()
export class DrizzleService implements OnModuleInit, AsyncDisposable {
  /**
   * Module configuration options injected during initialization.
   *
   * This property holds the connection configuration(s) provided during module
   * registration via `DrizzleOrmModule.register()` or `DrizzleOrmModule.registerAsync()`.
   * It can contain either a single connection configuration or an array of multiple
   * named connections.
   *
   * The options are used by `onModuleInit()` to establish database connections
   * during the application bootstrap process.
   *
   * @private
   * @readonly
   * ```
   */
  @Inject(DRIZZLE_CONNECTION_OPTIONS)
  private readonly [MODULE_OPTIONS]!: DrizzleOrmModuleOptions;

  /**
   * Internal registry storing all established database connections.
   *
   * This property maintains a hierarchical map structure where connections are
   * organized by database driver type and then by connection name. Each driver
   * type (e.g., "postgres", "sqlite") has its own Map of named connections.
   *
   * Connections are stored as {@linkcode DrizzleConnection} and cast to the appropriate type
   * ({@linkcode DrizzlePgDatabase}, {@linkcode DrizzleSqliteDatabase}) when retrieved via `pg()` or `sqlite()` methods.
   *
   * @private
   * @readonly
   */
  private readonly connections = {} as Record<
    DrizzleDrivers,
    Map<string, DrizzleConnection>
  >;

  /**
   * Lifecycle event, called when the module gets loaded and establishes all connections.
   *
   * @see {@linkcode OnModuleInit}
   */
  public async onModuleInit(): Promise<void> {
    const options = Array.isArray(this[MODULE_OPTIONS])
      ? this[MODULE_OPTIONS]
      : [{ name: "default", ...this[MODULE_OPTIONS] }];

    const drizzleFactories: Map<DrizzleDrivers, DrizzleFactory> = new Map();
    const postgresMetdata = {} as { drizzle: DrizzleFactory; Pool?: Type };

    for (const option of options) {
      const factory = await this.getDrizzleFactory(
        drizzleFactories,
        option,
      );

      this.connections[option.type] ??= new Map();

      switch (option.type) {
        case "postgres":
          postgresMetdata.drizzle ??= factory;

          await this.establishPostgresConnection(
            postgresMetdata,
            option,
          );

          break;

        case "sqlite":
          this.establishSqliteConnection(factory, option);

          break;
      }
    }
  }

  /**
   * Releases every connection opened by {@linkcode DrizzleService.onModuleInit}:
   * ends the `pg.Pool` of postgres connections and closes the libsql client of
   * sqlite connections.
   *
   * Called by the injector when the application context is closed, after all
   * shutdown hooks. Connections are removed from the registry before they are
   * closed, so calling it again is a no-op and `pg()` / `sqlite()` report them
   * as unknown afterwards.
   *
   * @returns {Promise<void>} Resolves once every connection is closed.
   * @throws {AggregateError} When one or more connections fail to close; every
   *   entry names the connection and carries the original error as `cause`.
   */
  public async [Symbol.asyncDispose](): Promise<void> {
    const closing: Promise<void>[] = [];

    for (
      const [type, connections] of Object.entries(this.connections) as [
        DrizzleDrivers,
        Map<string, DrizzleConnection>,
      ][]
    ) {
      for (const [name, db] of connections) {
        closing.push(this.closeConnection(type, name, db));
      }

      connections.clear();
    }

    const errors = (await Promise.allSettled(closing))
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to close ${errors.length} drizzle connection(s)`,
      );
    }
  }

  /**
   * Get a PostgreSQL database connection with the default name.
   *
   * @template TRelations - Relations registered through `drizzle.relations`
   * @param {Partial<NoThrowOption<false>>} options - Connection options (throws on error by default)
   * @returns {NodePgDatabase<TRelations>} A PostgreSQL database instance
   * @throws {DrizzleConnectionNotFoundError} If the connection cannot be established
   *
   * @example Basic usage
   * ```ts
   * import { users } from "./db/schema.ts";
   *
   * const db = drizzle.pg();
   * await db.select().from(users);
   * ```
   *
   * @example Relational queries
   * ```ts
   * import { relations } from "./db/relations.ts";
   *
   * const db = drizzle.pg<typeof relations>();
   * await db.query.users.findMany();
   * ```
   */
  public pg<TRelations extends AnyRelations = EmptyRelations>(
    options?: Partial<NoThrowOption<false>>,
  ): NodePgDatabase<TRelations>;
  /**
   * Get a PostgreSQL database connection with the default name.
   *
   * @template TRelations - Relations registered through `drizzle.relations`
   * @param {NoThrowOption<true>} options - Connection options with `noThrow` set to `true`
   * @returns {NodePgDatabase<TRelations> | undefined} A PostgreSQL database instance, or `undefined` if connection fails.
   *
   * @example Usage
   * ```ts
   * import { relations } from "./db/relations.ts";
   *
   * const db = drizzle.pg<typeof relations>({ noThrow: true });
   *
   * if (db) {
   *   await db.query.users.findMany();
   * }
   * ```
   */
  public pg<TRelations extends AnyRelations = EmptyRelations>(
    options: NoThrowOption<true>,
  ): NodePgDatabase<TRelations> | undefined;
  /**
   * Get a named PostgreSQL database connection.
   *
   * @template TRelations - Relations registered through `drizzle.relations`
   * @param {string} name - The connection name
   * @param {Partial<NoThrowOption<false>>} options - Connection options (throws on error by default)
   * @returns {NodePgDatabase<TRelations>} A PostgreSQL database instance
   * @throws {DrizzleConnectionNotFoundError} If the connection cannot be established
   *
   * @example Usage
   * ```ts
   * const db = drizzle.pg("analytics");
   *
   * await db.select().from(events);
   * ```
   */
  public pg<TRelations extends AnyRelations = EmptyRelations>(
    name: string,
    options?: Partial<NoThrowOption<false>>,
  ): NodePgDatabase<TRelations>;
  /**
   * Get a named PostgreSQL database connection.
   *
   * @template TRelations - Relations registered through `drizzle.relations`
   * @param {string} name - The connection name
   * @param {NoThrowOption<true>} options - Connection options with `noThrow` set to `true`
   * @returns {NodePgDatabase<TRelations> | undefined} A PostgreSQL database instance, or `undefined` if connection fails
   *
   * @example
   * ```ts
   * const db = drizzle.pg("analytics", { noThrow: true });
   * if (db) {
   *   await db.select().from(events);
   * }
   * ```
   */
  public pg<TRelations extends AnyRelations = EmptyRelations>(
    name: string,
    options: NoThrowOption<true>,
  ): NodePgDatabase<TRelations> | undefined;
  public pg<TRelations extends AnyRelations>(
    optionsOrName?: Partial<NoThrowOption> | string,
    optionalOptions?: Partial<NoThrowOption>,
  ): NodePgDatabase<TRelations> | undefined {
    const name = typeof optionsOrName === "string" ? optionsOrName : "default";
    const options = typeof optionsOrName === "object"
      ? optionsOrName
      : optionalOptions;

    return this.getConnection<NodePgDatabase<TRelations>>(
      "postgres",
      name,
      options,
    );
  }

  /**
   * Get a SQLite database connection with the default name.
   *
   * @template TRelations - Relations registered through `drizzle.relations`
   * @param {Partial<NoThrowOption<false>>} options - Connection options (throws on error by default)
   * @returns {LibSQLDatabase<TRelations>} A SQLite database instance
   * @throws {DrizzleConnectionNotFoundError} If the connection cannot be established
   *
   * @example Basic usage
   * ```ts
   * import { users } from "./db/schema.ts";
   *
   * const db = drizzle.sqlite();
   * await db.select().from(users);
   * ```
   *
   * @example Relational queries
   * ```ts
   * import { relations } from "./db/relations.ts";
   *
   * const db = drizzle.sqlite<typeof relations>();
   * await db.query.users.findMany();
   * ```
   */
  public sqlite<TRelations extends AnyRelations = EmptyRelations>(
    options?: Partial<NoThrowOption<false>>,
  ): LibSQLDatabase<TRelations>;
  /**
   * Get a SQLite database connection with the default name.
   *
   * @template TRelations - Relations registered through `drizzle.relations`
   * @param {NoThrowOption<true>} options - Connection options with `noThrow` set to `true`
   * @returns {LibSQLDatabase<TRelations> | undefined} A SQLite database instance, or `undefined` if connection fails
   *
   * @example Usage
   * ```ts
   * import { relations } from "./db/relations.ts";
   *
   * const db = drizzle.sqlite<typeof relations>({ noThrow: true });
   *
   * if (db) {
   *   await db.query.users.findMany();
   * }
   * ```
   */
  public sqlite<TRelations extends AnyRelations = EmptyRelations>(
    options: NoThrowOption<true>,
  ): LibSQLDatabase<TRelations> | undefined;
  /**
   * Get a named SQLite database connection.
   *
   * @template TRelations - Relations registered through `drizzle.relations`
   * @param {string} name - The connection name
   * @param {Partial<NoThrowOption<false>>} options - Connection options (throws on error by default)
   * @returns {LibSQLDatabase<TRelations>} A SQLite database instance
   * @throws {DrizzleConnectionNotFoundError} If the connection cannot be established
   *
   * @example Usage
   * ```ts
   * const db = drizzle.sqlite("cache");
   *
   * await db.select().from(sessions);
   * ```
   */
  public sqlite<TRelations extends AnyRelations = EmptyRelations>(
    name: string,
    options?: Partial<NoThrowOption<false>>,
  ): LibSQLDatabase<TRelations>;
  /**
   * Get a named SQLite database connection.
   *
   * @template TRelations - Relations registered through `drizzle.relations`
   * @param {string} name - The connection name
   * @param {NoThrowOption<true>} options - Connection options with `noThrow` set to `true`
   * @returns {LibSQLDatabase<TRelations> | undefined} A SQLite database instance, or `undefined` if connection fails
   *
   * @example
   * ```ts
   * import { relations } from "./db/relations.ts";
   *
   * const db = drizzle.sqlite<typeof relations>("cache", { noThrow: true });
   *
   * if (db) {
   *   await db.query.sessions.findMany();
   * }
   * ```
   */
  public sqlite<TRelations extends AnyRelations = EmptyRelations>(
    name: string,
    options: NoThrowOption<true>,
  ): LibSQLDatabase<TRelations> | undefined;
  public sqlite<TRelations extends AnyRelations>(
    optionsOrName?: Partial<NoThrowOption> | string,
    optionalOptions?: Partial<NoThrowOption>,
  ): LibSQLDatabase<TRelations> | undefined {
    const name = typeof optionsOrName === "string" ? optionsOrName : "default";
    const options = typeof optionsOrName === "object"
      ? optionsOrName
      : optionalOptions;

    return this.getConnection<LibSQLDatabase<TRelations>>(
      "sqlite",
      name,
      options,
    );
  }

  /**
   * Establishes a PostgreSQL database connection and stores it in the `connections` map.
   *
   * drizzle's `node-postgres` driver always talks to PostgreSQL through a
   * `pg.Pool`; `connection` is its configuration in both modes:
   * - Pool mode: Creates the pg.Pool from this package's `pg` import and hands it to drizzle as `client`
   * - Default mode: Hands `connection` to drizzle, which creates the pg.Pool itself
   *
   * The `drizzle` options (relations, logger, cache, codecs, ...) are forwarded in both modes.
   *
   * @private
   * @param {{ drizzle: DrizzleFactory, Pool?: Type }} metadata - Object containing the Drizzle factory function and optional Pool constructor
   * @param {DrizzleFactory} metadata.drizzle - The Drizzle ORM factory function for PostgreSQL
   * @param {Pool} metadata.Pool - Optional pg.Pool constructor (will be imported if not provided)
   * @param {DrizzleOrmPostgresConnectionOptions} options - PostgreSQL connection configuration options
   * @param {DrizzleDrivers} options.type - The driver type (should be "postgres")
   * @param {string} options.name - The connection name for storage and retrieval
   * @param {boolean} options.pool - Whether this package creates the pg.Pool
   * @param {string|DrizzlePostgresPoolOptions} options.connection - Connection string or configuration object
   * @param {DrizzlePgConfig} options.drizzle - Additional Drizzle configuration options
   * @returns {Promise<void>} A promise that resolves when the connection is established
   * @throws {DrizzleMissingDependencyError} If pg.Pool cannot be imported when pool mode is enabled
   *
   * @example Usage
   * ```ts
   * await this.establishPostgresConnection(
   *   { drizzle: drizzleFactory },
   *   {
   *     type: "postgres",
   *     name: "default",
   *     pool: true,
   *     connection: "postgresql://localhost/mydb"
   *   }
   * );
   * ```
   */
  private async establishPostgresConnection(
    metadata: { drizzle: DrizzleFactory; Pool?: Type },
    options: DrizzleOrmPostgresConnectionOptions,
  ): Promise<void> {
    if (options.pool) {
      if (!metadata.Pool) {
        const { module: { Pool }, errorOptions } = await this.tryImport<
          { Pool: Type }
        >("pg");

        if (!Pool) {
          throw new DrizzleMissingDependencyError(
            options.type,
            "pg",
            errorOptions,
          );
        }

        metadata.Pool = Pool;
      }

      this.connections[options.type].set(
        options.name,
        metadata.drizzle({
          ...options.drizzle,
          client: new metadata.Pool(
            typeof options.connection !== "string" ? options.connection : {
              connectionString: options.connection,
            } satisfies DrizzlePostgresPoolOptions,
          ),
        }),
      );
    } else {
      this.connections[options.type].set(
        options.name,
        metadata.drizzle({
          ...options.drizzle,
          connection: options.connection,
        }),
      );
    }
  }

  /**
   * Establishes a SQLite database connection and stores it in the connections map.
   *
   * Creates a new Drizzle SQLite instance using the provided database and configuration,
   * then stores it under the specified name for later retrieval. A `database`
   * without a URL scheme is a file path and is turned into a `file:` URL, the
   * only form the libsql client accepts for local files.
   *
   * @private
   * @param {DrizzleFactory} drizzle - The Drizzle ORM factory function for SQLite/LibSQL
   * @param {DrizzleOrmSqliteConnectionOptions} options - SQLite connection configuration options
   * @param {DrizzleDrivers} options.type - The driver type (should be "sqlite")
   * @param {string} options.name - The connection name for storage and retrieval
   * @param {string} options.database - The database file path or libsql URL
   * @param {DrizzleSQLiteConfig} options.drizzle - Additional Drizzle configuration options
   *
   * @example Usage
   * ```ts
   * this.establishSqliteConnection(
   *   drizzleFactory,
   *   {
   *     type: "sqlite",
   *     name: "default",
   *     database: "./local.db",
   *     drizzle: { relations }
   *   }
   * );
   * ```
   */
  private establishSqliteConnection(
    drizzle: DrizzleFactory,
    options: DrizzleOrmSqliteConnectionOptions,
  ): void {
    const url = URL_SCHEME.test(options.database)
      ? options.database
      // libsql percent-decodes the path, keep `%`, `?` and `#` literal
      : `file:${options.database.replace(/[%?#]/g, encodeURIComponent)}`;

    this.connections[options.type].set(
      options.name,
      drizzle(url, options.drizzle),
    );
  }

  /**
   * Retrieves or imports the Drizzle factory function for a specific database driver.
   *
   * This method implements lazy loading and caching of Drizzle factory functions.
   * If the factory for the requested driver type is already cached, it returns immediately.
   * Otherwise, it dynamically imports the appropriate Drizzle package and caches the factory.
   *
   * @private
   * @param {Map<DrizzleDrivers, DrizzleFactory>} factories - Map storing cached Drizzle factory functions by driver type
   * @param {DrizzleOrmBaseConnectionOptions} options - Connection options containing the driver type
   * @param {DrizzleDrivers} options.type - The database driver type (e.g., "postgres", "sqlite")
   * @returns {Promise<DrizzleFactory>} A promise that resolves to the Drizzle factory function
   * @throws {DrizzleFactoryNotFoundError} If the drizzle export cannot be found in the package
   *
   * @example Usage
   * ```ts
   * const drizzle = await this.getDrizzleFactory(
   *   this.factories,
   *   { type: "postgres" }
   * );
   *
   * const db = drizzle(options);
   * ```
   */
  private async getDrizzleFactory(
    factories: Map<DrizzleDrivers, DrizzleFactory>,
    options: DrizzleOrmBaseConnectionOptions,
  ): Promise<DrizzleFactory> {
    let factory = factories.get(options.type);

    if (!factory) {
      const packageName = DRIVER_PACKAGES[options.type];
      const { module: { drizzle }, errorOptions } = await this.tryImport<
        { drizzle: DrizzleFactory }
      >(packageName);

      if (!drizzle) {
        throw new DrizzleFactoryNotFoundError(packageName, errorOptions);
      }

      factory = drizzle;

      factories.set(options.type, factory);
    }

    return factory;
  }

  /**
   * Retrieves a database connection from the connection registry.
   *
   * This method looks up a connection by its type and name. By default, it throws
   * an error if the connection is not found, but can optionally return `undefined`
   * instead when `noThrow` is set to `true`.
   *
   * @private
   * @template T - The expected database connection type
   * @param {DrizzleDrivers} type - The database driver type (e.g., "postgres", "sqlite")
   * @param {string} name - The connection name
   * @param {Partial<NoThrowOption>} options - Optional behavior configuration
   * @param {boolean} options.noThrow - If `true`, returns `undefined` instead of throwing when connection not found
   * @returns The database connection instance, or `undefined` if not found and `noThrow` is `true`
   * @throws {DrizzleConnectionNotFoundError} If connection not found and `noThrow` is `false` / `undefined`
   *
   * @example Usage
   * ```ts
   * // throws DrizzleConnectionNotFoundError if not found
   * const db = this.getConnection<NodePgDatabase>("postgres", "default");
   *
   * // returns undefined if not found
   * const db = this.getConnection<NodePgDatabase>(
   *   "postgres",
   *   "default",
   *   { noThrow: true }
   * );
   * ```
   */
  private getConnection<T>(
    type: DrizzleDrivers,
    name: string,
    options?: Partial<NoThrowOption>,
  ): T | undefined {
    const connection = this.connections[type]?.get(name);

    if (!connection) {
      if (options?.noThrow) {
        return undefined;
      }

      throw new DrizzleConnectionNotFoundError(name, type);
    }

    return connection as T;
  }

  /**
   * Closes the driver client behind a drizzle database instance: ends a
   * `pg.Pool`, closes a libsql `Client`.
   *
   * @private
   * @param {DrizzleDrivers} type - The database driver type, used in the error message
   * @param {string} name - The connection name, used in the error message
   * @param {DrizzleConnection} db - The drizzle database instance holding the client in `$client`
   * @returns {Promise<void>} Resolves once the client is closed.
   * @throws {Error} Naming the connection, with the close failure as `cause`.
   */
  private async closeConnection(
    type: DrizzleDrivers,
    name: string,
    db: DrizzleConnection,
  ): Promise<void> {
    const client = db.$client;

    try {
      if ("end" in client) {
        await client.end();
      } else {
        client.close();
      }
    } catch (cause) {
      throw new Error(`Failed to close ${type} connection: ${name}`, {
        cause,
      });
    }
  }

  /**
   * Imports a driver package, keeping the import failure instead of throwing.
   *
   * @private
   * @template T - The expected module shape
   * @param {string} name - The package specifier to import
   * @returns {Promise<{ module: Partial<T>; errorOptions?: ErrorOptions }>}
   *   The imported module, or an empty module plus the import error as
   *   `cause` when the import failed.
   */
  private async tryImport<T>(
    name: string,
  ): Promise<{ module: Partial<T>; errorOptions?: ErrorOptions }> {
    try {
      return { module: await this.import<T>(name) };
    } catch (cause) {
      return { module: {}, errorOptions: { cause } };
    }
  }

  // deno-coverage-ignore-start
  /**
   * Dynamic driver loader kept as a switch over **string-literal** specifiers
   * rather than a variable-driven `import(name)`.
   *
   * When this package is consumed from JSR, the runtime dynamic import is
   * evaluated in the module's own https://jsr.io/... scope, which has no
   * import map, and the consumer's `deno.json` `imports` does not propagate
   * there either (deno#26266). Only static-analyzable string-literal
   * specifiers get captured in the JSR module graph and rewritten to the
   * fully-qualified `npm:` URL at publish time. Using literals here keeps
   * the peer-optional semantics (dynamic import, failures handled by
   * {@linkcode DrizzleService.tryImport}) while making the dependencies
   * visible to JSR's publish-time analyzer.
   */
  private async import<T = Record<PropertyKey, unknown>>(
    name: string,
  ): Promise<Partial<T>> {
    switch (name) {
      case "drizzle-orm/node-postgres":
        return (await import(
          "drizzle-orm/node-postgres"
        )) as unknown as Partial<T>;
      case "drizzle-orm/libsql":
        return (await import("drizzle-orm/libsql")) as unknown as Partial<T>;
      case "pg":
        return (await import("pg")) as unknown as Partial<T>;
      default:
        return {};
    }
  }
  // deno-coverage-ignore-stop
}
