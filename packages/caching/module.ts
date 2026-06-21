import {
  type DynamicModule,
  type FactoryProvider,
  Module,
  type ModuleRef,
  type OnModuleDestroy,
  type OnModuleInit,
  type ValueProvider,
} from "@denorid/injector";
import { createCache } from "cache-manager";
import { CACHE_MANAGER, CACHING_MODULE_OPTIONS } from "./_constants.ts";
import type {
  Cache,
  CachingAsyncModuleOptions,
  CachingModuleOptions,
} from "./module_options.ts";

export { CACHE_MANAGER } from "./_constants.ts";

/**
 * Denorid module that registers a `cache-manager` `Cache` instance backed by Keyv.
 *
 * Use {@link CachingModule.forRoot} for static options or
 * {@link CachingModule.forRootAsync} when options must be resolved from injected
 * providers. The resolved cache is available under the {@link CACHE_MANAGER}
 * token or via the `InjectCache()` helper.
 *
 * @example Synchronous registration with in-memory default
 * ```ts
 * \@Module({ imports: [CachingModule.forRoot({ ttl: 60_000 })] })
 * class AppModule {}
 * ```
 *
 * @example Async registration backed by a config service
 * ```ts
 * CachingModule.forRootAsync({
 *   imports: [ConfigModule],
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({
 *     ttl: config.get("CACHE_TTL"),
 *   }),
 * });
 * ```
 */
@Module({})
export class CachingModule implements OnModuleInit, OnModuleDestroy {
  public constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * @inheritdoc
   */
  public async onModuleInit(): Promise<void> {
    // Eager-resolve so user-supplied Keyv stores connect at startup and the
    // destroy hook always has a live `Cache` to disconnect.
    await this.moduleRef.get<Cache>(CACHE_MANAGER);
  }

  /**
   * @inheritdoc
   */
  public async onModuleDestroy(): Promise<void> {
    const cache = await this.moduleRef.get<Cache>(CACHE_MANAGER);

    await cache.disconnect();
  }

  /**
   * Registers `CachingModule` with static options.
   *
   * @param {CachingModuleOptions} [options] - Module configuration. Defaults
   *   to an in-memory cache with no TTL.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRoot(options: CachingModuleOptions = {}): DynamicModule {
    return this.createDynamicModule(options, { useValue: options });
  }

  /**
   * Registers `CachingModule` with options resolved via an async factory.
   *
   * @param {CachingAsyncModuleOptions} options - Async module configuration.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRootAsync(
    options: CachingAsyncModuleOptions,
  ): DynamicModule {
    return this.createDynamicModule(options, {
      useFactory: options.useFactory,
      inject: options.inject,
    });
  }

  private static createDynamicModule(
    options: CachingModuleOptions | CachingAsyncModuleOptions,
    optionsProviderData: Omit<ValueProvider | FactoryProvider, "provide">,
  ): DynamicModule {
    return {
      module: CachingModule,
      global: options.global,
      imports: (options as CachingAsyncModuleOptions).imports ?? [],
      providers: [
        {
          provide: CACHING_MODULE_OPTIONS,
          ...optionsProviderData,
        } as ValueProvider | FactoryProvider,
        {
          provide: CACHE_MANAGER,
          useFactory: (opts: CachingModuleOptions): Cache =>
            createCache({
              stores: opts.stores,
              ttl: opts.ttl,
              refreshThreshold: opts.refreshThreshold,
              refreshAllStores: opts.refreshAllStores,
              nonBlocking: opts.nonBlocking,
              cacheId: opts.cacheId,
            }),
          inject: [CACHING_MODULE_OPTIONS],
        } satisfies FactoryProvider,
        ...((options as CachingAsyncModuleOptions).extraProviders ?? []),
      ],
      exports: [CACHE_MANAGER],
    };
  }
}
