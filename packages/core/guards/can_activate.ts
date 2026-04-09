import type { ExecutionContext } from "../guards/execution_context.ts";

/**
 * Interface defining the `canActivate()` function that must be implemented
 * by a guard. The return value indicates wether or not the current request
 * is allowed to proceed. Return can be either synchronous (`boolean`) or
 * asynchronous (`Promose<boolean>`).
 */
export interface CanActivate {
  /**
   * @param {ExecutionContext} context Current execution context, provides
   * access to details about the current request pipeline.
   *
   * @returns {boolean|Promise<boolean>} Value indicating wether or not
   * the request is allowed to proceed.
   */
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean>;
}

/**
 * Type defining the activation guard function signature that must be used
 * by a guard. The return value indicates wether or not the current request
 * is allowed to proceed. Return can be either synchronous (`boolean`) or
 * asynchronous (`Promose<boolean>`).
 *
 * @param {ExecutionContext} context Current execution context, provides
 * access to details about the current request pipeline.
 *
 * @returns {boolean|Promise<boolean>} Value indicating wether or not
 * the request is allowed to proceed.
 */
export type CanActivateFn = (
  context: ExecutionContext,
) => boolean | Promise<boolean>;
