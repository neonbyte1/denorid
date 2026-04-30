import { assertEquals, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { KvConnections } from "../connections.ts";
import { KvQueue } from "./queue.ts";

function createQueue(connections: KvConnections): KvQueue {
  const queue = Object.create(KvQueue.prototype) as KvQueue;

  Object.defineProperty(queue, "connections", { value: connections });

  return queue;
}

describe(KvQueue.name, () => {
  it("enqueues an id-only message on the default queue", async () => {
    const result = { ok: true, versionstamp: "1" } as Deno.KvCommitResult;
    const calls: unknown[][] = [];
    const queue = createQueue({
      get: (name?: string) => {
        calls.push(["get", name]);

        return {
          enqueue: (message: unknown, options: unknown) => {
            calls.push(["enqueue", message, options]);

            return Promise.resolve(result);
          },
        } as unknown as Deno.Kv;
      },
    } as KvConnections);

    assertStrictEquals(await queue.send({ id: "event" }), result);
    assertEquals(calls, [
      ["get", undefined],
      ["enqueue", { id: "event" }, undefined],
    ]);
  });

  it("enqueues payloads, named queues, and enqueue options", async () => {
    const result = { ok: true, versionstamp: "2" } as Deno.KvCommitResult;
    const options = { delay: 100, keysIfUndelivered: [["dead"] as Deno.KvKey] };
    const calls: unknown[][] = [];
    const queue = createQueue({
      get: (name?: string) => {
        calls.push(["get", name]);

        return {
          enqueue: (message: unknown, enqueueOptions: unknown) => {
            calls.push(["enqueue", message, enqueueOptions]);

            return Promise.resolve(result);
          },
        } as unknown as Deno.Kv;
      },
    } as KvConnections);

    assertStrictEquals(
      await queue.send({
        id: "event",
        queue: "emails",
        payload: { userId: 1 },
        options,
      }),
      result,
    );
    assertEquals(calls, [
      ["get", "emails"],
      ["enqueue", { id: "event", payload: { userId: 1 } }, options],
    ]);
  });

  it("omits falsy payload values from the queue message", async () => {
    const calls: unknown[][] = [];
    const queue = createQueue({
      get: () =>
        ({
          enqueue: (message: unknown) => {
            calls.push(["enqueue", message]);

            return Promise.resolve({
              ok: true,
              versionstamp: "3",
            } as Deno.KvCommitResult);
          },
        }) as unknown as Deno.Kv,
    } as KvConnections);

    await queue.send({ id: "event", payload: null as unknown as object });

    assertEquals(calls, [["enqueue", { id: "event" }]]);
  });

  it("returns the atomic operation when requested", () => {
    const atomicOperation = {
      enqueue: (message: unknown, options: unknown) => {
        calls.push(["atomic.enqueue", message, options]);

        return atomicOperation;
      },
    } as unknown as Deno.AtomicOperation;
    const calls: unknown[][] = [];
    const options = { backoffSchedule: [10, 20] };
    const queue = createQueue({
      get: (name?: string) => {
        calls.push(["get", name]);

        return {
          atomic: () => {
            calls.push(["atomic"]);

            return atomicOperation;
          },
        } as unknown as Deno.Kv;
      },
    } as KvConnections);

    assertStrictEquals(
      queue.send({
        id: "event",
        queue: "emails",
        payload: { userId: 1 },
        options,
        atomic: true,
      }),
      atomicOperation,
    );
    assertEquals(calls, [
      ["get", "emails"],
      ["atomic"],
      [
        "atomic.enqueue",
        { id: "event", payload: { userId: 1 } },
        options,
      ],
    ]);
  });
});
