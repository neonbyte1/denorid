import { Global, Module } from "@denorid/injector";
import { CONFIG_CACHE, CONFIG_MODULE_OPTIONS } from "./_constants.ts";

/**
 * Per-application memo. A `global: true` registration resolves its providers
 * once in the module container and once in the global container; memoizing
 * the async options and the service by a stable key makes both share one
 * result.
 *
 * @internal
 */
export class ConfigCache {
  private readonly entries = new WeakMap<object, Promise<unknown>>();

  /**
   * Returns the value memoized for `key`, creating it on first use.
   *
   * @template T - The memoized value.
   * @param {object} key - Identity of the value.
   * @param {() => T | Promise<T>} create - Creates the value.
   * @return {Promise<T>} The memoized value.
   */
  public memo<T>(key: object, create: () => T | Promise<T>): Promise<T> {
    let entry = this.entries.get(key) as Promise<T> | undefined;

    if (!entry) {
      entry = (async (): Promise<T> => await create())();
      this.entries.set(key, entry);
    }

    return entry;
  }
}

/**
 * Application wide home of the config options and cache.
 *
 * The injector keeps a single container per module class, filled by whichever
 * `ConfigModule` variant it builds first. Carrying the `forRoot` options
 * through this global module (via a dynamic variant with the same class)
 * makes them reach every `ConfigModule` regardless of import order. Its
 * providers are intentionally not exported, so lookups fall through to the
 * global container, which holds the options of the last registered variant.
 *
 * @internal
 */
@Global()
@Module({
  providers: [
    { provide: CONFIG_MODULE_OPTIONS, useValue: {} },
    { provide: CONFIG_CACHE, useFactory: (): ConfigCache => new ConfigCache() },
  ],
})
export class ConfigHostModule {}
