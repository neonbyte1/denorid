import type {
  GenericFunction,
  InjectableMode,
  InjectionToken,
  Type,
} from "./common.ts";

/**
 * Base structure for all explicit providers.
 */
export interface BaseProvider {
  /**
   * The token that identifies the provider in the container.
   */
  provide: InjectionToken;
}

/**
 * Registers a class to be instantiated for a token.
 *
 * @template T - The provided value
 */
export interface ClassProvider<T = unknown> extends BaseProvider {
  /**
   * The class to instantiate when the token is resolved.
   *
   * @note The `Container` is aware of the lifecycle mode.
   */
  useClass: Type<T>;
}

/**
 * Registers a factory function for a token.
 *
 * @template T - The provided value
 */
export interface FactoryProvider<T = unknown> extends BaseProvider {
  /**
   * The factory function that returns the value or a Promise of the value.
   */
  useFactory: GenericFunction<T | Promise<T>>;
  /**
   * Optional list of tokens to inject as arguments into the factory function.
   */
  inject?: InjectionToken[];

  /**
   * Optional mode controlling how the factory is instantiated.
   */
  mode?: InjectableMode;
}

/**
 * Registers a value for a token.
 *
 * @template T - The provided value
 */
export interface ValueProvider<T = unknown> extends BaseProvider {
  /**
   * The value to return when the token is resolved.
   */
  useValue: T;
}

/**
 * Creates an alias for another token.
 *
 * @template T - The provided value
 */
export interface ExistingProvider<T = unknown> extends BaseProvider {
  useExisting: InjectionToken<T>;
}

/**
 * Union type representing all native provider types.
 *
 * @template T - The provided value
 */
export type NativeProvider<T = unknown> =
  | ClassProvider<T>
  | FactoryProvider<T>
  | ValueProvider<T>
  | ExistingProvider<T>;

/**
 * Union type representing class type or any native provider, used to register
 * any type of provider in the container.
 */
export type Provider<T = unknown> =
  | Type<T>
  | NativeProvider<T>;

/**
 * Base interface for provider guard check options.
 */
export interface ProviderCheckOptions {
  /**
   * If set to `true` then {@linkcode isBaseProvider} won't be called before validating
   * the _use_ field of a provider.
   *
   * @default false
   */
  excludeBaseCheck?: boolean;
}

/**
 * Checks whether `data` is a {@linkcode BaseProvider}.
 *
 * @param {unknown} data - The value to check.
 * @param {ProviderCheckOptions} [options] - Optional flags controlling the check behaviour.
 * @returns {boolean} `true` if `data` satisfies the {@linkcode BaseProvider} shape.
 */
export function isBaseProvider(
  data: unknown,
  options?: ProviderCheckOptions,
): data is BaseProvider {
  return typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    (options?.excludeBaseCheck ? true : "provide" in data);
}

/**
 * Checks whether `data` is a {@linkcode ClassProvider}.
 *
 * @param {unknown} data - The value to check.
 * @param {ProviderCheckOptions} [options] - Optional flags controlling the check behaviour.
 * @returns {boolean} `true` if `data` satisfies the {@linkcode ClassProvider} shape.
 */
export function isClassProvider(
  data: unknown,
  options?: ProviderCheckOptions,
): data is ClassProvider {
  return isBaseProvider(data, options) && "useClass" in data;
}

/**
 * Checks whether `data` is a {@linkcode FactoryProvider}.
 *
 * @param {unknown} data - The value to check.
 * @param {ProviderCheckOptions} [options] - Optional flags controlling the check behaviour.
 * @returns {boolean} `true` if `data` satisfies the {@linkcode FactoryProvider} shape.
 */
export function isFactoryProvider(
  data: unknown,
  options?: ProviderCheckOptions,
): data is FactoryProvider {
  return isBaseProvider(data, options) && "useFactory" in data;
}

/**
 * Checks whether `data` is a {@linkcode ValueProvider}.
 *
 * @param {unknown} data - The value to check.
 * @param {ProviderCheckOptions} [options] - Optional flags controlling the check behaviour.
 * @returns {boolean} `true` if `data` satisfies the {@linkcode ValueProvider} shape.
 */
export function isValueProvider(
  data: unknown,
  options?: ProviderCheckOptions,
): data is ValueProvider {
  return isBaseProvider(data, options) && "useValue" in data;
}

/**
 * Checks whether `data` is an {@linkcode ExistingProvider}.
 *
 * @param {unknown} data - The value to check.
 * @param {ProviderCheckOptions} [options] - Optional flags controlling the check behaviour.
 * @returns {boolean} `true` if `data` satisfies the {@linkcode ExistingProvider} shape.
 */
export function isExistingProvider(
  data: unknown,
  options?: ProviderCheckOptions,
): data is ExistingProvider {
  return isBaseProvider(data, options) && "useExisting" in data;
}

/**
 * Extracts the injection token from a {@linkcode Provider}.
 *
 * For class providers (plain constructor functions) the class itself is returned.
 * For all native provider objects the `provide` token is returned.
 *
 * @param {Provider} provider - The provider to extract the token from.
 * @returns {InjectionToken} The injection token that identifies this provider in the container.
 */
export function getProviderToken(provider: Provider): InjectionToken {
  return typeof provider === "function" ? provider : provider.provide;
}
