/**
 * A versatile logger designed for both standalone use and integration with Denorid applications.
 *
 * Provides a structured, levelled logger ({@linkcode Logger}) with ANSI color
 * support, optional JSON output, and a pluggable {@linkcode LoggerService}
 * interface for custom logger implementations.
 *
 * @example
 * ```ts
 * import { Logger } from "@denorid/logger";
 *
 * const logger = new Logger("AppModule");
 * logger.log("Application started");
 * logger.warn("Low memory");
 * logger.error("Something went wrong");
 * ```
 *
 * @module
 */
export * from "./logger.ts";
export * from "./logger_service.ts";
export * from "./options.ts";
