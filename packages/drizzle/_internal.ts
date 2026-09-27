import type { DrizzleDrivers } from "./module_options.ts";

export const DRIZZLE_CONNECTION_OPTIONS = Symbol.for(
  "drizzle.connection_options",
);

export const MODULE_OPTIONS = Symbol.for("drizzle.module_options");

export const DRIVER_PACKAGES: Record<DrizzleDrivers, string> = {
  sqlite: "drizzle-orm/libsql",
  postgres: "drizzle-orm/node-postgres",
};

/**
 * `drizzle-kit` package spec spawned by the CLI commands on every runtime.
 *
 * Pinned to the release published together with the `drizzle-orm` version in
 * this package's `deno.json`: the migration folder layout changed in v1, so
 * the kit and the ORM runtime migrator have to be bumped in lockstep.
 */
export const DRIZZLE_KIT_PACKAGE = "drizzle-kit@1.0.0-rc.4";
