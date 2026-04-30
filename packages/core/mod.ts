/**
 * The Denorid core module, providing the foundational building blocks for
 * creating HTTP applications with route mapping, exception handling, and pipes.
 *
 * This module exports the application bootstrap factory, HTTP application
 * context, controller mapping abstractions, built-in exception types, and
 * validation pipes.
 *
 * # Usage
 *
 * Typical usage involves creating an application via {@linkcode DenoridFactory}
 * and then listening for incoming requests:
 *
 * ```ts
 * import { DenoridFactory } from "@denorid/core";
 * import { HonoAdapter } from "@denorid/platform-hono";
 * import { AppModule } from "./app_module.ts";
 *
 * const app = await DenoridFactory.create(AppModule, new HonoAdapter());
 * await app.listen();
 * ```
 *
 * @module
 */
export * from "./application.ts";
export * from "./application_context.ts";
export * from "./denorid_factory.ts";
export * from "./exceptions/mod.ts";
export * from "./guards/mod.ts";
export * from "./host_arguments.ts";
export * from "./http/mod.ts";
export {
  HttpApplication,
  type HttpApplicationOptions,
  type HttpCoreApplicationOptions,
  type InternalHttpApplicationOptions,
} from "./http_application.ts";
export * from "./microservices/mod.ts";
export * from "./pipes/mod.ts";
export * from "./rpc_host_arguments.ts";
export * from "./type_guards.ts";
