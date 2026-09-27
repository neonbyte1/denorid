/**
 * Token of the {@link ConfigModuleOptions} used to load the configuration.
 */
export const CONFIG_MODULE_OPTIONS = Symbol.for(
  "denorid.config.module_options",
);

/**
 * Token of the per-application `ConfigCache`.
 */
export const CONFIG_CACHE = Symbol.for("denorid.config.cache");
