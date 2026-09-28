import { assertEquals } from "@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { describe, it } from "node:test";
import { startInterval } from "./_interval_runtime.ts";

/** Thursday, 2026-01-01 00:00:00 UTC. */
const START = "2026-01-01T00:00:00.000Z";

/**
 * Advances fake time by `count` steps of `ms`, flushing microtasks after each
 * step like the event loop does between timer callbacks.
 */
async function advance(
  time: FakeTime,
  ms: number,
  count: number = 1,
): Promise<void> {
  for (let step = 0; step < count; step++) {
    await time.tickAsync(ms);
    await time.runMicrotasks();
  }
}

describe("startInterval", () => {
  it("runs the handler every delay, first one delay after the start", async () => {
    using time = new FakeTime(START);
    const runs: string[] = [];
    const handle = startInterval({
      name: "heartbeat",
      ms: 10_000,
      handler: () => {
        runs.push(new Date().toISOString());
      },
    });

    try {
      await advance(time, 9_999);

      assertEquals(runs, []);

      await advance(time, 1);
      await advance(time, 10_000, 2);

      assertEquals(runs, [
        "2026-01-01T00:00:10.000Z",
        "2026-01-01T00:00:20.000Z",
        "2026-01-01T00:00:30.000Z",
      ]);
    } finally {
      clearInterval(handle);
    }
  });

  it("skips ticks while the previous run is pending and resumes afterwards", async () => {
    using time = new FakeTime(START);
    const runs: string[] = [];
    let finish = (): void => {};
    const handle = startInterval({
      name: "heartbeat",
      ms: 10_000,
      handler: () => {
        runs.push(new Date().toISOString());

        const { promise, resolve } = Promise.withResolvers<void>();

        finish = resolve;

        return promise;
      },
    });

    try {
      await advance(time, 10_000, 3);

      assertEquals(runs, ["2026-01-01T00:00:10.000Z"]);

      finish();
      await advance(time, 10_000);

      assertEquals(runs, [
        "2026-01-01T00:00:10.000Z",
        "2026-01-01T00:00:40.000Z",
      ]);
    } finally {
      clearInterval(handle);
    }
  });

  it("logs thrown and rejected runs without stopping the interval", async () => {
    using time = new FakeTime(START);
    using errors = stub(console, "error");
    const thrown = new Error("thrown");
    const rejected = new Error("rejected");
    const outcomes: (() => void | Promise<void>)[] = [
      () => {
        throw thrown;
      },
      () => Promise.reject(rejected),
      () => {},
    ];
    let runs = 0;
    const handle = startInterval({
      name: "heartbeat",
      ms: 10_000,
      handler: () => outcomes[runs++](),
    });

    try {
      await advance(time, 10_000, 3);

      assertEquals(runs, 3);
      assertSpyCalls(errors, 2);
      assertSpyCallArgs(errors, 0, [
        "Exception in interval handler heartbeat",
        thrown,
      ]);
      assertSpyCallArgs(errors, 1, [
        "Exception in interval handler heartbeat",
        rejected,
      ]);
    } finally {
      clearInterval(handle);
    }
  });
});
