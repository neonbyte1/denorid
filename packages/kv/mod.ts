/**
 * Denorid KV package: integrates Deno KV into a denorid application,
 * managing named connections and providing an event-driven queue system.
 *
 * Runs on Deno, Node.js and Bun. On Deno the native `Deno.openKv` opens the
 * stores (requires `--unstable-kv` or Deno Deploy, `":memory:"` selects an
 * in-memory store). On Node.js and Bun, as well as on Deno without the unstable
 * KV API, the `@deno/kv` package is used: an empty path selects its in-memory
 * store, an `http(s)://` URL a KV Connect endpoint and any other path a SQLite
 * file. Per-connection `openOptions` are forwarded to `openKv` of `@deno/kv`.
 *
 * Bun: `@deno/kv` refuses SQLite and remote stores on Bun because Bun's
 * `node:v8` serializes with JavaScriptCore instead of V8. Use an empty path for
 * an in-memory store, or pass serializers explicitly: either Bun's `node:v8`
 * functions (data is then not readable by Deno or Node.js) or
 * `makeLimitedV8Serializer()` from `@deno/kv` (supports `string`, `boolean`,
 * `null` and `undefined` values only):
 *
 * ```ts ignore
 * import { KvModule } from "@denorid/kv";
 * import { deserialize, serialize } from "node:v8";
 *
 * KvModule.forRoot({
 *   connection: {
 *     path: "./data.db",
 *     openOptions: { encodeV8: serialize, decodeV8: deserialize },
 *   },
 * });
 * ```
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
/**
 * KV types from `@deno/kv` used in the public API ({@link KvConnections.get},
 * {@link InjectKv} fields, {@link KvQueue.send}, {@link EnqueueOptions}),
 * re-exported so consumers can annotate values without depending on
 * `@deno/kv` directly.
 */
export type { AtomicOperation, Kv, KvCommitResult, KvKey } from "@deno/kv";
