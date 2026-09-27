import {
  type DynamicModule,
  type FactoryProvider,
  Module,
} from "@denorid/injector";
import { CONFIG_CACHE, CONFIG_MODULE_OPTIONS } from "./_constants.ts";
import { type ConfigCache, ConfigHostModule } from "./_host.ts";
import { loadConfig } from "./_loader.ts";
import { ConfigService } from "./config_service.ts";
import { ConfigModuleImportOrderError } from "./exceptions.ts";
import type {
  ConfigModuleAsyncOptions,
  ConfigModuleOptions,
} from "./module_options.ts";

function createService(
  options: ConfigModuleOptions,
  cache: ConfigCache,
): Promise<ConfigService> {
  return cache.memo(
    options,
    async (): Promise<ConfigService> =>
      new ConfigService(await loadConfig(options)),
  );
}

const configServiceProvider: FactoryProvider<ConfigService> = {
  provide: ConfigService,
  useFactory: createService,
  inject: [CONFIG_MODULE_OPTIONS, CONFIG_CACHE],
};

/**
 * Module providing {@link ConfigService}.
 *
 * - `imports: [ConfigModule]` exposes the configuration registered by
 *   {@link ConfigModule.forRoot} / {@link ConfigModule.forRootAsync}
 *   elsewhere in the application, or the defaults (`.env` file plus runtime
 *   environment variables) when there is none.
 * - {@link ConfigModule.forRoot} registers the configuration with static
 *   options. Import order does not matter.
 * - {@link ConfigModule.forRootAsync} resolves the options through a
 *   factory. Unless registered with `global: true`, it must come before every
 *   module importing plain `ConfigModule`, otherwise resolving
 *   `ConfigService` throws a {@link ConfigModuleImportOrderError}.
 *
 * The configuration is loaded once per application.
 *
 * @example Static options
 * ```ts
 * \@Module({
 *   imports: [
 *     ConfigModule.forRoot({
 *       global: true,
 *       yamlFilePath: ["config.yaml", "config.local.yaml"],
 *     }),
 *   ],
 * })
 * class AppModule {}
 * ```
 *
 * @example Async options
 * ```ts
 * ConfigModule.forRootAsync({
 *   imports: [SecretsModule],
 *   inject: [SecretsService],
 *   useFactory: (secrets: SecretsService) => ({
 *     load: [() => secrets.fetchAll()],
 *   }),
 * });
 * ```
 */
@Module({
  imports: [ConfigHostModule],
  providers: [configServiceProvider],
  exports: [ConfigService],
})
export class ConfigModule {
  /**
   * Registers the configuration with static options.
   *
   * @param {ConfigModuleOptions} [options] - Module options. Defaults to the
   *   `.env` file plus runtime environment variables.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRoot(options: ConfigModuleOptions = {}): DynamicModule {
    return {
      module: ConfigModule,
      global: options.global,
      imports: [
        {
          module: ConfigHostModule,
          global: true,
          providers: [{ provide: CONFIG_MODULE_OPTIONS, useValue: options }],
        },
      ],
    };
  }

  /**
   * Registers the configuration with options resolved by a factory.
   *
   * @param {ConfigModuleAsyncOptions} options - Async module options.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRootAsync(options: ConfigModuleAsyncOptions): DynamicModule {
    // Stable per registration. With `global: true` the options factory runs
    // in the module container and again in the global container; keying the
    // service by registration (and by options object, for plain `ConfigModule`
    // resolving the global options) makes every path share one instance.
    const registrationKey = {};

    return {
      module: ConfigModule,
      global: options.global,
      imports: [
        {
          // Reached only when a plain `ConfigModule` claimed the module
          // container first, dropping the async options. A `global: true`
          // registration overrides it with its own global options provider.
          module: ConfigHostModule,
          global: true,
          providers: [{
            provide: CONFIG_MODULE_OPTIONS,
            useFactory: (): never => {
              throw new ConfigModuleImportOrderError();
            },
          }],
        },
        ...(options.imports ?? []),
      ],
      providers: [
        {
          provide: CONFIG_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject,
        },
        {
          provide: ConfigService,
          useFactory: (
            resolved: ConfigModuleOptions,
            cache: ConfigCache,
          ): Promise<ConfigService> =>
            cache.memo(registrationKey, () => createService(resolved, cache)),
          inject: [CONFIG_MODULE_OPTIONS, CONFIG_CACHE],
        },
        ...(options.extraProviders ?? []),
      ],
    };
  }
}
