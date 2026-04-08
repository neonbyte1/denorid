/**
 * HTTP exception classes for Denorid.
 *
 * Each class maps to a standard HTTP error status code and extends
 * {@linkcode HttpException}, which itself extends the built-in `Error`.
 * Throw any of these from a route handler and Denorid will serialize the
 * exception into a well-formed JSON response automatically.
 *
 * @example
 * ```ts
 * import { NotFoundException, BadRequestException } from "@denorid/core/exceptions/http";
 *
 * throw new NotFoundException();
 * // → 404 { "statusCode": 404, "message": "Not Found" }
 *
 * throw new BadRequestException("email must be an email");
 * // → 400 { "statusCode": 400, "message": "email must be an email", "error": "Bad Request" }
 *
 * throw new BadRequestException({ statusCode: 400, message: ["field is required"] });
 * // → 400 (custom body passed through as-is)
 * ```
 *
 * @module
 */
export * from "./bad_gateway.ts";
export * from "./bad_request.ts";
export * from "./base.ts";
export * from "./conflict.ts";
export * from "./content_too_large.ts";
export * from "./expectation_failed.ts";
export * from "./failed_dependency.ts";
export * from "./forbidden.ts";
export * from "./gateway_timeout.ts";
export * from "./gone.ts";
export * from "./insufficient_storage.ts";
export * from "./internal_server_error.ts";
export * from "./locked.ts";
export * from "./method_not_allowed.ts";
export * from "./not_acceptable.ts";
export * from "./not_found.ts";
export * from "./not_implemented.ts";
export * from "./payment_required.ts";
export * from "./precondition_failed.ts";
export * from "./precondition_required.ts";
export * from "./proxy_authentication_required.ts";
export * from "./range_not_satisfiable.ts";
export * from "./request_timeout.ts";
export * from "./service_unavailable.ts";
export * from "./teapot.ts";
export * from "./too_early.ts";
export * from "./too_many_requests.ts";
export * from "./unauthorized.ts";
export * from "./unavailable_for_legal_reasons.ts";
export * from "./unprocessable_context.ts";
export * from "./unsupported_media_type.ts";
export * from "./upgrade_required.ts";
export * from "./zod_validation.ts";
