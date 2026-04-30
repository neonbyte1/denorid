/**
 * KV queue sub-module providing decorators, message types, and the listener
 * service for event-driven Deno KV queue handlers.
 *
 * @example
 * ```ts
 * import { QueueHandler, Queued, KvQueue } from "@denorid/kv/queue";
 *
 * class UserCreatedDto {
 *   id!: string;
 *   email!: string;
 * }
 *
 * @QueueHandler()
 * class UserQueueHandler {
 *   @Queued("user.created", UserCreatedDto)
 *   onUserCreated(payload: UserCreatedDto): void {
 *     console.log("New user:", payload.id);
 *   }
 * }
 *
 * // Sending a message
 * declare const queue: KvQueue;
 * await queue.send({ id: "user.created", payload: { id: "1", email: "a@b.com" } });
 * ```
 *
 * @module
 */
export * from "./decorator.ts";
export * from "./listener.ts";
export * from "./message_options.ts";
export * from "./queue.ts";
