/**
 * Hono HTTP adapter for Denorid, bridging the Denorid application lifecycle
 * with the {@link https://hono.dev | Hono} web framework.
 *
 * This module exports the {@linkcode HonoAdapter}, which implements the
 * {@linkcode HttpAdapter} interface, along with its supporting
 * {@linkcode HonoControllerMapping} and {@linkcode HonoRequestContext} types,
 * and the native WebSocket adapter {@linkcode WsAdapter} with its
 * {@linkcode WsServer} and {@linkcode WsClient}.
 *
 * # Usage
 *
 * Pass a {@linkcode HonoAdapter} instance to {@linkcode DenoridFactory.create}
 * when bootstrapping your application:
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
export * from "./adapter.ts";
export * from "./controller_mapping.ts";
export * from "./request_context.ts";
export * from "./ws_adapter.ts";
export * from "./ws_client.ts";
export * from "./ws_server.ts";
