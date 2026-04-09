/**
 * HTTP primitives for the Denorid framework — controllers, route decorators,
 * status codes, and the request-context abstraction.
 *
 * @example
 * ```ts
 * import { Controller, Get, HttpCode, RequestContext } from "@denorid/core/http";
 *
 * @Controller("/users")
 * class UserController {
 *   @Get("/:id")
 *   @HttpCode(200)
 *   getUser(ctx: RequestContext): unknown {
 *     const id = ctx.param("id");
 *     return { id };
 *   }
 * }
 * ```
 *
 * @module
 */

export * from "./adapter.ts";
export * from "./controller.ts";
export * from "./controller_mapping.ts";
export * from "./controller_options.ts";
export * from "./http_code.ts";
export * from "./method.ts";
export * from "./request_context.ts";
export * from "./request_mapping.ts";
export * from "./status.ts";
export * from "./validation.ts";

export type { RequestMappingMetadata } from "./_request_mapping.ts";
