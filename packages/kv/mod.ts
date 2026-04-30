/**
 * Denorid KV package — integrates Deno KV into a denorid application,
 * managing named connections and providing an event-driven queue system.
 *
 * @example
 * ```ts
 * import { KvModule } from "@denorid/kv";
 * import { Application } from "@denorid/core";
 *
 * @Application({
 *   imports: [
 *     KvModule.forRoot({
 *       connections: [
 *         { name: "default", path: ":memory:", queue: true },
 *       ],
 *     }),
 *   ],
 * })
 * class App {}
 * ```
 *
 * @module
 */
export * from "./connections.ts";
export * from "./exceptions.ts";
export * from "./module.ts";
export * from "./module_options.ts";
export * from "./queue/mod.ts";
