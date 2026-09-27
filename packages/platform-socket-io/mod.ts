/**
 * @module
 *
 * {@link https://socket.io | socket.io} WebSocket adapter for Denorid
 * gateways. Attaches socket.io to the `node:http` server of the HTTP adapter
 * and serves every `@WebSocketGateway()` class through it: namespaces, rooms,
 * acknowledgements and the long-polling fallback included.
 *
 * ### Quick start
 *
 * ```ts
 * import { DenoridFactory } from "@denorid/core";
 * import { HonoAdapter } from "@denorid/platform-hono";
 * import { SocketIoAdapter } from "@denorid/platform-socket-io";
 * import { AppModule } from "./app_module.ts";
 *
 * const app = await DenoridFactory.create(AppModule, new HonoAdapter());
 * app.useWebSocketAdapter(new SocketIoAdapter(app));
 * await app.listen();
 * ```
 *
 * ### Exports
 *
 * | Symbol | Description |
 * |---|---|
 * | {@link SocketIoAdapter} | `WebSocketAdapter` implementation over socket.io |
 * | {@link SocketIoGatewayOptions} | `@WebSocketGateway()` options: `path`, `namespace` and socket.io server options |
 * | {@link Server} | Re-export of socket.io's `Server` type |
 * | {@link Namespace} | Re-export of socket.io's `Namespace` type |
 * | {@link Socket} | Re-export of socket.io's `Socket` type |
 */
export * from "./adapter.ts";
export * from "./gateway_options.ts";
export type { Namespace, Server, Socket } from "socket.io";
