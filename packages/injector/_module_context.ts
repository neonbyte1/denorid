import { AsyncLocalStorage } from "node:async_hooks";
import type { ModuleRef } from "./module_ref.ts";

/**
 * Internal storage for the current module context.
 * Uses Node.js AsyncLocalStorage to track the active ModuleRef.
 *
 * @internal
 */
const moduleContextStorage = new AsyncLocalStorage<ModuleRef>();

/**
 * Returns the current `ModuleRef` for the executing context.
 *
 * This is useful for resolving providers relative to the currently
 * active module when running inside a module context.
 *
 * @returns {ModuleRef|undefined} The function returns the current {@linkcode ModuleRef},
 *          or `undefined` if not inside a module context.
 *
 * @internal
 */
export function getCurrentModuleRef(): ModuleRef | undefined {
  return moduleContextStorage.getStore();
}

/**
 * Runs a function within the context of a given module reference.
 *
 * Establishes a temporary module context so that `getCurrentModuleRef()`
 * will return the provided `ModuleRef` during the execution of `fn`.
 *
 * @template T - The function return type
 * @param {ModuleRef} moduleRef - The module reference to use as the current context.
 * @param {() => T} fn - Callback executed within the module context
 * @returns {T} The function executes `fn` and returns its result.
 *
 * @internal
 */
export function runInModuleContext<T>(moduleRef: ModuleRef, fn: () => T): T {
  return moduleContextStorage.run(moduleRef, fn);
}
