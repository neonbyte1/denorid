import type { DynamicModule } from "@denorid/injector";
import { Module } from "../../injector/decorators.ts";
import { DRIZZLE_CONNECTION_OPTIONS } from "./_internal.ts";
import { DrizzleService } from "./drizzle_service.ts";
import type {
  DrizzleOrmAsyncModuleOptions,
  DrizzleOrmModuleOptions,
} from "./module_options.ts";

/**
 * Module for integrating Drizzle ORM with @denorid/injector.
 *
 * This module provides methods to register Drizzle database connections either
 * synchronously or asynchronously. It handles the setup of database connections
 * and makes them globally available throughout your application via the DrizzleService.
 *
 * The module supports:
 * - Single or multiple database connections
 * - PostgreSQL and SQLite databases
 * - Synchronous and asynchronous configuration
 * - Connection pooling for PostgreSQL
 *
 * @example Simple synchronous registration
 * ```ts
 * \@Module({
 *   imports: [
 *     DrizzleOrmModule.register({
 *       type: "postgres",
 *       connection: "postgresql://localhost/mydb",
 *       pool: true
 *     })
 *   ]
 * })
 * export class AppModule {}
 * ```
 *
 * @example Multiple connections
 * ```ts
 * \@Module({
 *   imports: [
 *     DrizzleOrmModule.register([
 *       {
 *         type: "postgres",
 *         name: "main",
 *         connection: process.env.MAIN_DB_URL,
 *         pool: true
 *       },
 *       {
 *         type: "sqlite",
 *         name: "cache",
 *         database: "./cache.db"
 *       }
 *     ])
 *   ]
 * })
 * export class AppModule {}
 * ```
 *
 * @example Asynchronous registration with ConfigService
 * ```ts
 * \@Module({
 *   imports: [
 *     DrizzleOrmModule.registerAsync({
 *       inject: [ConfigService],
 *       useFactory: (config: ConfigService) => ({
 *         type: "postgres",
 *         connection: config.get('DATABASE_URL'),
 *         pool: true
 *       })
 *     })
 *   ]
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class DrizzleOrmModule {
  /**
   * Synchronously registers the Drizzle ORM module with static configuration.
   *
   * Use this method when your database connection configuration is known at build time
   * and doesn't require async initialization. Supports both single and multiple
   * database connections.
   *
   * @param {DrizzleOrmModuleOptions} options - Database connection configuration options
   * @returns A dynamic module configuration object
   *
   * @example Single PostgreSQL connection
   * ```ts
   * DrizzleOrmModule.register({
   *   type: "postgres",
   *   connection: "postgresql://localhost/mydb",
   *   pool: true,
   *   drizzle: { schema }
   * })
   * ```
   *
   * @example Single SQLite connection (name defaults to "default")
   * ```ts
   * DrizzleOrmModule.register({
   *   type: "sqlite",
   *   database: "./local.db",
   *   drizzle: { schema }
   * })
   * ```
   *
   * @example Multiple named connections
   * ```ts
   * DrizzleOrmModule.register([
   *   {
   *     type: "postgres",
   *     name: "primary",
   *     connection: {
   *       host: "localhost",
   *       port: 5432,
   *       database: "main",
   *       user: "postgres",
   *       password: "secret",
   *       max: 20
   *     },
   *     pool: true
   *   },
   *   {
   *     type: "postgres",
   *     name: "analytics",
   *     connection: "postgresql://analytics-server/analytics",
   *     pool: true
   *   },
   *   {
   *     type: "sqlite",
   *     name: "cache",
   *     database: ":memory:"
   *   }
   * ])
   * ```
   */
  public static register(options: DrizzleOrmModuleOptions): DynamicModule {
    return {
      module: DrizzleOrmModule,
      providers: [
        {
          provide: DRIZZLE_CONNECTION_OPTIONS,
          useValue: options,
        },
        DrizzleService,
      ],
      exports: [DrizzleService],
    };
  }

  /**
   * Asynchronously registers the Drizzle ORM module with dynamic configuration.
   *
   * Use this method when database connection configuration needs to be determined
   * at runtime, such as:
   * - Loading from environment variables via a ConfigService
   * - Fetching from a remote configuration service
   * - Performing async validation or transformation of config values
   * - Computing connection options based on other injected services
   *
   * @param {DrizzleOrmAsyncModuleOptions} options - Asynchronous module configuration with factory function
   * @returns A dynamic module configuration object
   *
   * @example Using ConfigService for environment-based config
   * ```ts
   * DrizzleOrmModule.registerAsync({
   *   inject: [ConfigService],
   *   useFactory: (config: ConfigService) => ({
   *     type: "postgres",
   *     connection: config.get('DATABASE_URL'),
   *     pool: true,
   *     drizzle: {
   *       schema: mySchema,
   *       logger: config.get('NODE_ENV') === 'development'
   *     }
   *   })
   * })
   * ```
   *
   * @example Async initialization with multiple dependencies
   * ```ts
   * DrizzleOrmModule.registerAsync({
   *   inject: [ConfigService, SecretsManager],
   *   useFactory: async (config: ConfigService, secrets: SecretsManager) => {
   *     const password = await secrets.getSecret('DB_PASSWORD');
   *
   *     return {
   *       type: "postgres",
   *       connection: {
   *         host: config.get('DB_HOST'),
   *         port: config.get('DB_PORT'),
   *         database: config.get('DB_NAME'),
   *         user: config.get('DB_USER'),
   *         password,
   *         max: 20
   *       },
   *       pool: true
   *     };
   *   }
   * })
   * ```
   *
   * @example Multiple connections with async config
   * ```ts
   * DrizzleOrmModule.registerAsync({
   *   inject: [ConfigService],
   *   useFactory: async (config: ConfigService) => [
   *     {
   *       type: "postgres",
   *       name: "main",
   *       connection: await config.get('DATABASE_URL'),
   *       pool: true
   *     },
   *     {
   *       type: "sqlite",
   *       name: "cache",
   *       database: config.get('CACHE_DB_PATH')
   *     }
   *   ]
   * })
   * ```
   *
   * @example Without dependencies (async operation but no injection)
   * ```ts
   * DrizzleOrmModule.registerAsync({
   *   useFactory: async () => {
   *     const config = await loadConfigFromFile('./db-config.json');
   *
   *     return {
   *       type: "postgres",
   *       connection: config.url,
   *       pool: true
   *     };
   *   }
   * })
   * ```
   */
  public static registerAsync(
    options: DrizzleOrmAsyncModuleOptions,
  ): DynamicModule {
    return {
      module: DrizzleOrmModule,
      providers: [
        {
          provide: DRIZZLE_CONNECTION_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject,
        },
        DrizzleService,
      ],
      exports: [DrizzleService],
    };
  }
}
