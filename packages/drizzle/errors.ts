/**
 * Error thrown when the Drizzle factory function cannot be found in a driver package.
 *
 * This error occurs during dynamic import when the expected `drizzle` export is not
 * present in the database driver package. This typically indicates a package installation
 * issue or an incompatible package version.
 *
 * @extends Error
 *
 * @example Usage
 * ```ts
 * try {
 *   const { drizzle } = await import("drizzle-orm/libsql");
 *   if (!drizzle) {
 *     throw new DrizzleFactoryNotFoundError("drizzle-orm/libsql");
 *   }
 * } catch (error) {
 *   console.error(error.message);
 * }
 * ```
 */
export class DrizzleFactoryNotFoundError extends Error {
  /**
   * Creates a new DrizzleFactoryNotFoundError.
   *
   * @param {string} packageName - The name of the package where the drizzle factory was not found
   *
   * @example Usage
   * ```ts
   * new DrizzleFactoryNotFoundError("drizzle-orm/node-postgres");
   * ```
   */
  public constructor(packageName: string) {
    super(`Failed to get the drizzle factory from ${packageName}`);
  }
}

/**
 * Error thrown when attempting to retrieve a database connection that doesn't exist.
 *
 * This error occurs when calling `pg()`, `sqlite()`, or other connection methods with
 * a connection name that has not been registered. It can be avoided by using the
 * `noThrow` option, which returns undefined instead of throwing.
 *
 * @extends Error
 *
 * @example Usage
 * ```ts
 * // Avoiding the error with noThrow option
 * const db = manager.pg("analytics", { noThrow: true });
 * if (!db) {
 *   console.log("Connection 'analytics' not found");
 * }
 *
 * // Or handle the error explicitly
 * try {
 *   const db = manager.pg("analytics");
 * } catch (error) {
 *   if (error instanceof DrizzleConnectionNotFoundError) {
 *     console.error("Connection not registered");
 *   }
 * }
 * ```
 */
export class DrizzleConnectionNotFoundError extends Error {
  /**
   * Creates a new DrizzleConnectionNotFoundError.
   *
   * @param {string} name - The name of the connection that was not found
   * @param {DrizzleDrivers} type - The database driver type (e.g., "postgres", "sqlite")
   *
   * @example Usage
   * ```ts
   * new DrizzleConnectionNotFoundError("analytics", "postgres");
   * new DrizzleConnectionNotFoundError("cache", "sqlite");
   * ```
   */
  public constructor(name: string, type: string) {
    super(`Unknown ${type} connection: ${name}`);
  }
}

/**
 * Error thrown when a required database driver dependency is not installed.
 *
 * This error occurs when attempting to establish a database connection but the
 * underlying driver package (like `pg` for PostgreSQL) is not available. The error
 * message provides clear instructions on which package needs to be installed.
 *
 * @extends Error
 *
 * @example Usage
 * ```ts
 * // Typical usage when checking for Pool availability
 * try {
 *   const { Pool } = await import("pg");
 *   if (!Pool) {
 *     throw new DrizzleMissingDependencyError("postgres", "pg");
 *   }
 * } catch (error) {
 *   if (error instanceof DrizzleMissingDependencyError) {
 *     console.error("Please run: npm install pg");
 *   }
 * }
 * ```
 */
export class DrizzleMissingDependencyError extends Error {
  /**
   * Creates a new DrizzleMissingDependencyError.
   *
   * @param {DrizzleDrivers} type - The database driver type (e.g., "postgres", "sqlite", "mysql")
   * @param {string} packageName - The npm package name that needs to be installed
   *
   * @example
   * ```ts
   * new DrizzleMissingDependencyError("postgres", "pg");
   * ```
   */
  public constructor(type: string, packageName: string) {
    super(
      `Unable to establish ${type} connection because of a missing dependency. Please install ${packageName}`,
    );
  }
}
