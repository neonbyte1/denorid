/**
 * Guards — request authorization primitives for Denorid.
 *
 * A guard is evaluated before a route handler is invoked and decides whether
 * the current request should be allowed to proceed. Guards can be applied to
 * an entire controller class or to individual route handler methods via the
 * {@link UseGuards} decorator.
 *
 * ### Implementing a guard
 *
 * Implement the {@link CanActivate} interface or provide a plain
 * {@link CanActivateFn} function:
 *
 * ```ts
 * import { type CanActivate, type ExecutionContext } from "@denorid/core";
 *
 * class AuthGuard implements CanActivate {
 *   public canActivate(ctx: ExecutionContext): boolean {
 *     // inspect ctx to decide whether to allow the request
 *     return true;
 *   }
 * }
 * ```
 *
 * ### Binding guards
 *
 * Use the {@link UseGuards} decorator to attach guards to a controller or
 * handler:
 *
 * ```ts
 * import { Controller, UseGuards } from "@denorid/core";
 *
 * @UseGuards(AuthGuard)
 * @Controller('/protected')
 * class ProtectedController {}
 * ```
 *
 * @see {@link CanActivate}
 * @see {@link CanActivateFn}
 * @see {@link ExecutionContext}
 * @see {@link UseGuards}
 *
 * @module
 */
export * from "./can_activate.ts";
export * from "./decorator.ts";
export * from "./execution_context.ts";
