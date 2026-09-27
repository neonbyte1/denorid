/**
 * @module
 *
 * Configuration package for Denorid. Loads YAML files, `.env` files, custom
 * factories and environment variables into a {@link ConfigService}, wired up
 * via the Denorid injector.
 *
 * ### Quick start
 *
 * ```ts
 * // .env file + environment variables
 * \@Module({ imports: [ConfigModule] })
 * class AppModule {}
 *
 * // Static options
 * ConfigModule.forRoot({ global: true, yamlFilePath: "config.yaml" });
 *
 * // Async options
 * ConfigModule.forRootAsync({
 *   useFactory: async () => ({ yamlFilePath: await findConfigFile() }),
 * });
 * ```
 *
 * ### Exports
 *
 * | Symbol | Description |
 * |---|---|
 * | {@link ConfigModule} | Denorid module - import as is, via `forRoot` or `forRootAsync` |
 * | {@link ConfigService} | Reads configuration values by dot separated paths |
 * | {@link ConfigModuleOptions} | Options of `forRoot` |
 * | {@link ConfigModuleAsyncOptions} | Options of `forRootAsync` |
 * | {@link ConfigFactory} | Custom configuration source (`load`) |
 * | {@link ConfigValidator} | Validation hook (`validate`) |
 * | {@link ConfigPath} | Typed dot paths of a configuration shape |
 * | {@link ConfigPathValue} | Value type at a dot path |
 * | {@link ConfigKeyNotFoundError} | Thrown by `getOrThrow` for missing keys |
 * | {@link ConfigFileError} | Thrown for unreadable or invalid files |
 * | {@link ConfigModuleImportOrderError} | Thrown when `forRootAsync` options were dropped |
 */
export * from "./config_service.ts";
export * from "./exceptions.ts";
export * from "./module.ts";
export * from "./module_options.ts";
