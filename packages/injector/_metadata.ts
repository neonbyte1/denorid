import type {
  InjectableOptions,
  InjectionToken,
  InjectOptions,
} from "./common.ts";

export const INJECTION_METADATA = Symbol.for("denorid.injection");
export const INJECTABLE_METADATA = Symbol.for("denorid.injectable");
export const MODULE_METADATA = Symbol.for("denorid.module");
export const GLOBAL_MODULE_METADATA = Symbol.for("denorid.global_module");
export const TAG_METADATA = Symbol.for("denorid.tags");

export interface InjectableMetadata extends InjectableOptions {
  /**
   * Random generated during decoration.
   */
  id: string;
}

export interface InjectionDependency {
  field: string | symbol;
  token: InjectionToken;
  options?: InjectOptions;
}
