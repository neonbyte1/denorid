/** Metadata key for storing injection token information on constructor parameters. */
export const INJECTION_METADATA = Symbol.for("denorid.injection");

/** Metadata key for marking a class as injectable (i.e. managed by the DI container). */
export const INJECTABLE_METADATA = Symbol.for("denorid.injectable");

/** Metadata key for storing module configuration (providers, imports, exports, controllers) on a class. */
export const MODULE_METADATA = Symbol.for("denorid.module");

/** Metadata key for marking a module as global, making its exports available application-wide without explicit import. */
export const GLOBAL_MODULE_METADATA = Symbol.for("denorid.global_module");

/** Metadata key for associating string tags with an injectable for multi-provider lookup. */
export const TAG_METADATA = Symbol.for("denorid.tags");
