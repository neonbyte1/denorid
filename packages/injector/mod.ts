/**
 * Contains the core concept of the denorid dependency injection.
 *
 * This module exports all the key functionality for creating and managing
 * a DI container, registering providers / modules and resolving dependencies.
 *
 * # Usage
 *
 * Typical usage involves creating a {@linkcode InjectorContext}, triggering hooks
 * and resolving instances:
 *
 * ```ts
 * import { InjectorContext } from "jsr:@denorid/injector";
 *
 * const ctx = await InjectorContext.create(AppModule);
 *
 * await ctx.onApplicationBootstrap();
 *
 * // get the instantiated AppModule instance
 * const appModule = await ctx.resolve(AppModule);
 *
 * await ctx.close("SIGTERM");
 * ```
 * @module
 */
export * from "./common.ts";
export * from "./container.ts";
export * from "./decorators.ts";
export * from "./errors.ts";
export * from "./hooks.ts";
export * from "./injector_context.ts";
export * from "./module_ref.ts";
export * from "./modules.ts";
export * from "./provider.ts";
