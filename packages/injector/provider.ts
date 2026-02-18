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
