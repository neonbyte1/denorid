/**
 * Exception handling primitives for Denorid.
 *
 * This module exposes:
 * - {@linkcode ExceptionFilter} - interface for implementing custom exception filters
 * - {@linkcode Catch} - class decorator to register a filter for a specific exception type
 * - {@linkcode ExceptionHandler} - resolves and dispatches registered filters at runtime
 * - {@linkcode IntrinsicException} - base class for framework-internal exceptions that skip error logging
 * - All built-in HTTP exception classes (e.g. {@linkcode NotFoundException}, {@linkcode BadRequestException})
 *
 * @example
 * ```ts
 * import {
 *   Catch,
 *   ExceptionFilter,
 *   HttpException,
 *   HostArguments,
 * } from "@denorid/core/exceptions";
 * import type { Context } from "@hono/hono";
 *
 * @Catch(HttpException)
 * export class HttpExceptionFilter implements ExceptionFilter<HttpException> {
 *   public catch(exception: HttpException, host: HostArguments) {
 *     const ctx = host.switchToHttp().getResponse<Context>();
 *     const request = ctx.req.raw;
 *     const statusCode = exception.status;
 *
 *     return ctx.json({
 *       statusCode,
 *       occurred: new Date().toISOString(),
 *       path: request.url,
 *     });
 *   }
 * }
 * ```
 *
 * @module
 */
export * from "./context_not_available.ts";
export * from "./filter.ts";
export * from "./handler.ts";
export * from "./http/mod.ts";
export * from "./intrinsic.ts";
