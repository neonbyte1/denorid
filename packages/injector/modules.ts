import type { InjectionToken, Type } from "./common.ts";
import type { Provider } from "./provider.ts";

/**
 * Metadata describing a module's configuration.
 */
export interface ModuleMetadata {
  imports?: (Type | DynamicModule | Promise<DynamicModule>)[];
  providers?: Provider[];
  exports?: InjectionToken[];
}

/**
 * Represents a dynamic module, extending {@linkcode ModuleMetadata}.
 */
export interface DynamicModule extends ModuleMetadata {
  /**
   * The main module class.
   */
  module: Type;

  /**
   * Wether this module should be globally available.
   *
   * @default false
   */
  global?: boolean;
}
