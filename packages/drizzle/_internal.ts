import type { DrizzleDrivers } from "./module_options.ts";

export const DRIZZLE_CONNECTION_OPTIONS = Symbol.for(
  "drizzle.connection_options",
);

export const MODULE_OPTIONS = Symbol.for("drizzle.module_options");

export const DRIVER_PACKAGES: Record<DrizzleDrivers, string> = {
  sqlite: "drizzle-orm/libsql",
  postgres: "drizzle-orm/node-postgres",
};
