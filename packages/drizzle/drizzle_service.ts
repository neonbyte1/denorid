import {
  type GenericFunction,
  Inject,
  Injectable,
  type OnModuleInit,
  type Type,
} from "@denorid/injector";
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
 * Type representing a Drizzle ORM schema object containing table and relation definitions.
 *
 * A Drizzle schema is a collection of table definitions, relations, indexes, and other
 * database structure elements exported from your schema files. This type is used to
 * provide type-safe database queries and enable features like relational queries.
 *
 * The schema is typically created by exporting all table definitions from a schema file
 * and passing them to Drizzle's configuration. It enables TypeScript to infer the correct
 * types for your queries based on your database structure.
 *
 * @example Define your schema in a file (e.g., schema.ts)
 * ```ts
 * import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
 *
 * export const users = pgTable('users', {
 *   id: serial('id').primaryKey(),
 *   name: text('name').notNull(),
 *   email: text('email').notNull().unique(),
 *   createdAt: timestamp('created_at').defaultNow()
 * });
 *
 * export const posts = pgTable('posts', {
 *   id: serial('id').primaryKey(),
 *   title: text('title').notNull(),
 *   content: text('content'),
 *   authorId: integer('author_id').references(() => users.id)
 * });
 *
 * // The schema is the collection of all exports
 * // Type: DrizzleSchema = { users: typeof users, posts: typeof posts }
 * ```
 *
 * @example Using schema with module registration
 * ```ts
 * import * as schema from "./db/schema.ts";
 *
 * DrizzleOrmModule.register({
 *   type: "postgres",
 *   connection: "postgresql://localhost/mydb",
 *   pool: true,
 *   drizzle: { schema } // Pass the schema for type-safe queries
 * })
 * ```
 *
 * @example Using typed database with schema
 * ```ts
 * import * as schema from "./db/schema.ts";
 *
 * type MyDb = DrizzlePgDatabase<typeof schema>;
 *
 * async function getUsers(db: MyDb) {
 *   // TypeScript knows about all tables and their columns
 *   return db.select().from(schema.users);
 * }
 * ```
 *
 * @example Schema with relations for relational queries
 * ```ts
 * import { relations } from "drizzle-orm";
 *
 * export const users = pgTable('users', {
 *   id: serial('id').primaryKey(),
 *   name: text('name').notNull()
 * });
 *
 * export const posts = pgTable("posts", {
 *   id: serial("id").primaryKey(),
 *   authorId: integer("author_id").references(() => users.id)
 * });
 *
 * export const usersRelations = relations(users, ({ many }) => ({
 *   posts: many(posts)
 * }));
 *
 * export const postsRelations = relations(posts, ({ one }) => ({
 *   author: one(users, {
 *     fields: [posts.authorId],
 *     references: [users.id]
 *   })
 * }));
 *
 * // Full schema includes tables and relations
 * // Type: DrizzleSchema = { users, posts, usersRelations, postsRelations }
 * ```
 *
 * @example Multiple schema files can be combined
 * ```ts
 * import * as userSchema from "./db/schema/users.ts";
 * import * as postSchema from "./db/schema/posts.ts";
 *
 * const schema: DrizzleSchema = {
 *   ...userSchema,
 *   ...postSchema
 * };
 *
 * DrizzleOrmModule.register({
 *   type: "postgres",
 *   connection: process.env.DATABASE_URL,
 *   drizzle: { schema }
 * })
 * ```
 *
 * @example SQLite schema example
 * ```ts
 * import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
 *
 * export const tasks = sqliteTable('tasks', {
 *   id: integer("id").primaryKey(),
 *   title: text("title").notNull(),
 *   completed: integer("completed", { mode: "boolean" }).default(false)
 * });
 *
 * // Type: DrizzleSchema = { tasks: typeof tasks }
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
 * @template T - Optional Drizzle schema type for type-safe queries (defaults to DrizzleSchema)
 *
 * @see {@link https://orm.drizzle.team/docs/get-started-postgresql | Drizzle PostgreSQL Documentation}
 *
 * @example
 * ```ts Using in a service with dependency injection with a typed schema
 * export class UserService {
 *   @Inject(DrizzleService)
 *   private readonly drizzle!: DrizzleService;
 *
 *   private _db: DrizzlePgDatabase<typeof schema>;
 *
 *   private get db(): DrizzlePgDatabase<typeof schema> {
 *     return (this._db ??= this.drizzle.pg<typeof schema>());
 *   }
 *
 *   public async findUsers(): Promise<User[]> {
 *     return this.db.query.users.findMany();
 *   }
 * }
 * ```
 *
 * @example
 * ```ts
 * // With a typed schema
 * import * as schema from "./db/schema.ts";
 *
 * type MyDatabase = DrizzlePgDatabase<typeof schema>;
 *
 * function queryUsers(db: MyDatabase) {
 *   return db.select().from(schema.users);
 * }
 * ```
 */
export type DrizzlePgDatabase = NodePgDatabase;

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
 * @template T - Optional Drizzle schema type for type-safe queries (defaults to DrizzleSchema)
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
 * @example
 * ```ts With a typed schema
 * import * as schema from './schema';
 *
 * type MyCacheDb = DrizzleSqliteDatabase<typeof schema>;
 *
 * async function cleanExpired(db: MyCacheDb) {
 *   await db.delete(schema.cache)
 *     .where(lt(schema.cache.expiresAt, new Date()));
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
export type DrizzleSqliteDatabase = LibSQLDatabase;

/**
 * Core service for managing and accessing Drizzle ORM database connections.
 *
 * @implements {OnModuleInit}
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
 * @example With typed schema
 * ```ts
 * import * as schema from "./schema";
 *
 * \@Injectable()
 * export class ProductService {
 *   \@Inject(DrizzleService)
 *   private readonly drizzle!: DrizzleService;
 *
 *   public async getProducts() {
 *     const db = this.drizzle.pg<typeof schema>();
 *
 *     return db.query.products.getMany();
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
 *     const analyticsDb = this.drizzle.pg<typeof schema>("analytics", { noThrow: true });
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
export class DrizzleService implements OnModuleInit {
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
   * Connections are stored as `unknown` and cast to the appropriate type
   * ({@linkcode DrizzlePgDatabase}, {@linkcode DrizzleSqliteDatabase}) when retrieved via `pg()` or `sqlite()` methods.
   *
   * @private
   * @readonly
   */
  private readonly connections = {} as Record<
    DrizzleDrivers,
    Map<string, unknown>
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

    const drizzleFactories: Map<DrizzleDrivers, GenericFunction> = new Map();
    const postgresMetdata = {} as { drizzle: GenericFunction; Pool?: Type };

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
   * Get a PostgreSQL database connection with the default name.
   *
   * @template T - The Drizzle schema type
   * @param {Partial<NoThrowOption<false>>} options - Connection options (throws on error by default)
   * @returns A PostgreSQL database instance
   * @throws {DrizzleConnectionNotFoundError} If the connection cannot be established
   *
   * @example Basic usage
   * ```ts
   * import * as schema from "./db/schema.ts";
   *
   * const db = drizzle.pg<typeof schema>();
   * await db.select().from(users);
   * ```
   *
   * @example Query language
   * import * as schema from "./db/schema.ts";
   *
   * const db = drizzle.pg<typeof schema>();
   * await db.query.users.findMany();
   */
  public pg<T extends DrizzleSchema = DrizzleSchema>(
    options?: Partial<NoThrowOption<false>>,
  ): NodePgDatabase<T>;
  /**
   * Get a PostgreSQL database connection with the default name.
   *
   * @template T - The Drizzle schema type
   * @param {NoThrowOption<true>} options - Connection options with `noThrow` set to `true`
   * @returns A PostgreSQL database instance, or `undefined` if connection fails.
   *
   * @example Usage
   * ```ts
   * import * as schema from "./db/schema.ts";
   *
   * const db = drizzle.pg<typeof schema>({ noThrow: true });
   *
   * if (db) {
   *   await db.select().from(users);
   * }
   * ```
   */
  public pg<T extends DrizzleSchema = DrizzleSchema>(
    options: NoThrowOption<true>,
  ): NodePgDatabase<T> | undefined;
  /**
   * Get a named PostgreSQL database connection.
   *
   * @template T - The Drizzle schema type
   * @param {string} name - The connection name
   * @param {Partial<NoThrowOption<false>>} options - Connection options (throws on error by default)
   * @returns A PostgreSQL database instance
   * @throws {DrizzleConnectionNotFoundError} If the connection cannot be established
   *
   * @example Usage
   * ```ts
   * const db = drizzle.pg("analytics");
   *
   * await db.select().from(events);
   * ```
   */
  public pg<T extends DrizzleSchema = DrizzleSchema>(
    name: string,
    options?: Partial<NoThrowOption<false>>,
  ): NodePgDatabase<T>;
  /**
   * Get a named PostgreSQL database connection.
   *
   * @template T - The Drizzle schema type
   * @param {string} name - The connection name
   * @param {NoThrowOption<true>} options - Connection options with `noThrow` set to `true`
   * @returns A PostgreSQL database instance, or `undefined` if connection fails
   *
   * @example
   * ```ts
   * const db = drizzle.pg("analytics", { noThrow: true });
   * if (db) {
   *   await db.select().from(events);
   * }
   * ```
   */
  public pg<T extends DrizzleSchema = DrizzleSchema>(
    name: string,
    options: NoThrowOption<true>,
  ): NodePgDatabase<T> | undefined;
  public pg<T extends DrizzleSchema>(
    optionsOrName?: Partial<NoThrowOption> | string,
    optionalOptions?: Partial<NoThrowOption>,
  ): NodePgDatabase<T> | undefined {
    const name = typeof optionsOrName === "string" ? optionsOrName : "default";
    const options = typeof optionsOrName === "object"
      ? optionsOrName
      : optionalOptions;

    return this.getConnection<NodePgDatabase<T>>(
      "postgres",
      name,
      options,
    );
  }

  /**
   * Get a SQLite database connection with the default name.
   *
   * @template T - The Drizzle schema type
   * @param {Partial<NoThrowOption<false>>} options - Connection options (throws on error by default)
   * @returns A SQLite database instance
   * @throws {DrizzleConnectionNotFoundError} If the connection cannot be established
   *
   * @example Basic usage
   * ```ts
   * import * as schema from "./db/schema.ts";
   *
   * const db = drizzle.sqlite<typeof schema>();
   * await db.select().from(users);
   * ```
   *
   * @example Query language
   * ```ts
   * import * as schema from "./db/schema.ts";
   *
   * const db = drizzle.sqlite<typeof schema>();
   * await db.query.users.findMany();
   * ```
   */
  public sqlite<T extends DrizzleSchema = DrizzleSchema>(
    options?: Partial<NoThrowOption<false>>,
  ): LibSQLDatabase<T>;
  /**
   * Get a SQLite database connection with the default name.
   *
   * @template T - The Drizzle schema type
   * @param {NoThrowOption<true>} options - Connection options with `noThrow` set to `true`
   * @returns A SQLite database instance, or `undefined` if connection fails
   *
   * @example Usage
   * ```ts
   * import * as schema from "./db/schema.ts";
   *
   * const db = drizzle.sqlite<typeof schema>({ noThrow: true });
   *
   * if (db) {
   *   await db.select().from(users);
   * }
   * ```
   */
  public sqlite<T extends DrizzleSchema = DrizzleSchema>(
    options: NoThrowOption<true>,
  ): LibSQLDatabase<T> | undefined;
  /**
   * Get a named SQLite database connection.
   *
   * @template T - The Drizzle schema type
   * @param {string} name - The connection name
   * @param {Partial<NoThrowOption<false>>} options - Connection options (throws on error by default)
   * @returns A SQLite database instance
   * @throws {DrizzleConnectionNotFoundError} If the connection cannot be established
   *
   * @example Usage
   * ```ts
   * const db = drizzle.sqlite("cache");
   *
   * await db.select().from(sessions);
   * ```
   */
  public sqlite<T extends DrizzleSchema = DrizzleSchema>(
    name: string,
    options?: Partial<NoThrowOption<false>>,
  ): LibSQLDatabase<T>;
  /**
   * Get a named SQLite database connection.
   *
   * @template T - The Drizzle schema type
   * @param {string} name - The connection name
   * @param {NoThrowOption<true>} options - Connection options with `noThrow` set to `true`
   * @returns A SQLite database instance, or `undefined` if connection fails
   *
   * @example
   * ```ts
   * import * as schema from "./db/schema.ts";
   *
   * const db = drizzle.sqlite<typeof schema>("cache", { noThrow: true });
   *
   * if (db) {
   *   await db.select().from(sessions);
   * }
   * ```
   */
  public sqlite<T extends DrizzleSchema = DrizzleSchema>(
    name: string,
    options: NoThrowOption<true>,
  ): LibSQLDatabase<T> | undefined;
  public sqlite<T extends DrizzleSchema>(
    optionsOrName?: Partial<NoThrowOption> | string,
    optionalOptions?: Partial<NoThrowOption>,
  ): LibSQLDatabase<T> | undefined {
    const name = typeof optionsOrName === "string" ? optionsOrName : "default";
    const options = typeof optionsOrName === "object"
      ? optionsOrName
      : optionalOptions;

    return this.getConnection<LibSQLDatabase<T>>(
      "sqlite",
      name,
      options,
    );
  }

  /**
   * Establishes a PostgreSQL database connection and stores it in the `connections` map.
   *
   * This method handles two connection modes:
   * - Pool mode: Creates a new pg.Pool instance using the provided connection options
   * - Direct mode: Uses the provided connection object directly with drizzle
   *
   * @private
   * @param {{ drizzle: GenericFunction, Pool?: Type }} metadata - Object containing the Drizzle factory function and optional Pool constructor
   * @param {GenericFunction} metadata.drizzle - The Drizzle ORM factory function for PostgreSQL
   * @param {Pool} metadata.Pool - Optional pg.Pool constructor (will be imported if not provided)
   * @param {DrizzleOrmPostgresConnectionOptions} options - PostgreSQL connection configuration options
   * @param {DrizzleDrivers} options.type - The driver type (should be "postgres")
   * @param {string} options.name - The connection name for storage and retrieval
   * @param {boolean} options.pool - Whether to use connection pooling
   * @param {string|DrizzlePostgresPoolOptions} options.connection - Connection string or configuration object
   * @param {DrizzleConfig} options.drizzle - Additional Drizzle configuration options
   * @returns A promise that resolves when the connection is established
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
    metadata: { drizzle: GenericFunction; Pool?: Type },
    options: DrizzleOrmPostgresConnectionOptions,
  ): Promise<void> {
    if (options.pool) {
      if (!metadata.Pool) {
        const { Pool } = await this.import<{ Pool: Type }>("pg");

        if (!Pool) {
          throw new DrizzleMissingDependencyError(options.type, "pg");
        }

        metadata.Pool = Pool;
      }

      this.connections[options.type].set(
        options.name,
        metadata.drizzle({
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
        metadata.drizzle(options.connection, options.drizzle),
      );
    }
  }

  /**
   * Establishes a SQLite database connection and stores it in the connections map.
   *
   * Creates a new Drizzle SQLite instance using the provided database and configuration,
   * then stores it under the specified name for later retrieval.
   *
   * @private
   * @param {GenericFunction} drizzle - The Drizzle ORM factory function for SQLite/LibSQL
   * @param {DrizzleOrmSqliteConnectionOptions} options - SQLite connection configuration options
   * @param {DrizzleDrivers} options.type - The driver type (should be "sqlite")
   * @param {string} options.name - The connection name for storage and retrieval
   * @param {string} options.database - The database client or connection object
   * @param {DrizzleConfig} options.drizzle - Additional Drizzle configuration options
   *
   * @example Usage
   * ```ts
   * this.establishSqliteConnection(
   *   drizzleFactory,
   *   {
   *     type: "sqlite",
   *     name: "default",
   *     database: sqliteClient,
   *     drizzle: { schema }
   *   }
   * );
   * ```
   */
  private establishSqliteConnection(
    drizzle: GenericFunction,
    options: DrizzleOrmSqliteConnectionOptions,
  ): void {
    this.connections[options.type].set(
      options.name,
      drizzle(options.database, options.drizzle),
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
   * @param {Map<DrizzleDrivers, GenericFunction>} factories - Map storing cached Drizzle factory functions by driver type
   * @param {DrizzleOrmBaseConnectionOptions} options - Connection options containing the driver type
   * @param {DrizzleDrivers} options.type - The database driver type (e.g., "postgres", "sqlite")
   * @returns A promise that resolves to the Drizzle factory function
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
    factories: Map<DrizzleDrivers, GenericFunction>,
    options: DrizzleOrmBaseConnectionOptions,
  ): Promise<GenericFunction> {
    let factory = factories.get(options.type);

    if (!factory) {
      const { drizzle } = await this.import<{ drizzle: GenericFunction }>(
        DRIVER_PACKAGES[options.type],
      );

      if (!drizzle) {
        throw new DrizzleFactoryNotFoundError(DRIVER_PACKAGES[options.type]);
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

  // deno-coverage-ignore-start
  private async import<T = Record<PropertyKey, unknown>>(
    name: string,
  ): Promise<Partial<T>> {
    try {
      return await import(name);
    } catch {
      return {};
    }
  }
  // deno-coverage-ignore-stop
}
