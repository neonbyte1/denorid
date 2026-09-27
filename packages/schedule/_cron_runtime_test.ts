import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import {
  assertSpyCallArgs,
  assertSpyCalls,
  spy,
  type Stub,
  stub,
} from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { describe, it } from "node:test";
import {
  cronHost,
  type CronHostScope,
  type CronJobSpec,
  registerCronJob,
  toCronExpression,
} from "./_cron_runtime.ts";
import type { CronSchedule } from "./cron_schedule.ts";

/** Thursday, 2026-01-01 00:00:00 UTC. */
const START = "2026-01-01T00:00:00.000Z";
const MINUTE = 60_000;

interface SimulatedRuntime extends Disposable {
  controller: AbortController;
  errors: Stub<Console, unknown[], void>;
  runs: string[];
  mark(): void;
  advance(ms: number): Promise<void>;
  job(overrides?: Partial<CronJobSpec>): CronJobSpec;
}

/**
 * Simulates a runtime exposing `scope` as its global scope, with fake timers
 * starting at `start` and `console.error` captured.
 */
function simulateRuntime(
  scope: CronHostScope,
  start: string = START,
): SimulatedRuntime {
  const originalScope = cronHost.scope;
  const time = new FakeTime(start);
  const errors = stub(console, "error");
  const controller = new AbortController();
  const runs: string[] = [];
  const mark = (): void => {
    runs.push(new Date().toISOString());
  };

  cronHost.scope = scope;

  return {
    controller,
    errors,
    runs,
    mark,
    async advance(ms: number): Promise<void> {
      await time.tickAsync(ms);
      await time.runMicrotasks();
    },
    job(overrides: Partial<CronJobSpec> = {}): CronJobSpec {
      return {
        name: "job",
        schedule: "* * * * *",
        handler: mark,
        signal: controller.signal,
        ...overrides,
      };
    },
    [Symbol.dispose](): void {
      controller.abort();
      errors.restore();
      time.restore();
      cronHost.scope = originalScope;
    },
  };
}

describe("registerCronJob", () => {
  describe("when Deno.cron is available", () => {
    it("hands the job to Deno.cron unchanged and does not schedule it itself", async () => {
      const cron = spy((..._args: unknown[]) => Promise.resolve());
      using runtime = simulateRuntime({ Deno: { cron } });
      const schedule: CronSchedule = { minute: { every: 5 } };
      const job = runtime.job({ schedule, backoffSchedule: [10, 20] });

      registerCronJob(job);

      assertSpyCalls(cron, 1);
      assertSpyCallArgs(cron, 0, [
        "job",
        schedule,
        { signal: runtime.controller.signal, backoffSchedule: [10, 20] },
        job.handler,
      ]);
      assertStrictEquals(cron.calls[0].args[1], schedule);

      await runtime.advance(10 * MINUTE);

      assertEquals(runtime.runs, []);
    });
  });

  describe("when Deno.cron is unavailable", () => {
    const runtimes: [string, CronHostScope][] = [
      ["Bun and Node.js (no Deno global)", {}],
      ["Deno without --unstable-cron", { Deno: {} }],
    ];

    for (const [label, scope] of runtimes) {
      it(`schedules the job with croner on ${label}`, async () => {
        using runtime = simulateRuntime(scope);

        registerCronJob(runtime.job());
        await runtime.advance(MINUTE);
        await runtime.advance(MINUTE);

        assertEquals(runtime.runs, [
          "2026-01-01T00:01:00.000Z",
          "2026-01-01T00:02:00.000Z",
        ]);
      });
    }

    it("evaluates schedules in UTC", async () => {
      using runtime = simulateRuntime({}, "2026-01-01T11:59:00.000Z");

      registerCronJob(runtime.job({ schedule: { hour: 12 } }));
      await runtime.advance(MINUTE);

      assertEquals(runtime.runs, ["2026-01-01T12:00:00.000Z"]);
    });

    it("numbers weekdays like Deno.cron, starting with 1 for Sunday", async () => {
      // Friday, one minute before midnight.
      using runtime = simulateRuntime({}, "2026-01-02T23:59:00.000Z");

      registerCronJob(runtime.job({ schedule: "0 0 * * 1" }));
      await runtime.advance(MINUTE);

      assertEquals(runtime.runs, []);

      await runtime.advance(24 * 60 * MINUTE);

      assertEquals(runtime.runs, ["2026-01-04T00:00:00.000Z"]);
    });

    it("accepts steps with a numeric start derived from structured schedules", async () => {
      using runtime = simulateRuntime({});

      registerCronJob(
        runtime.job({ schedule: { minute: { start: 5, every: 15 } } }),
      );
      await runtime.advance(5 * MINUTE);
      await runtime.advance(15 * MINUTE);

      assertEquals(runtime.runs, [
        "2026-01-01T00:05:00.000Z",
        "2026-01-01T00:20:00.000Z",
      ]);
    });

    it("rejects expressions Deno.cron rejects", () => {
      using runtime = simulateRuntime({});

      for (const schedule of ["0 0 0 * * *", "0 0 * * 0", "not a cron"]) {
        assertThrows(() => registerCronJob(runtime.job({ schedule })));
      }

      assertThrows(
        () =>
          registerCronJob(runtime.job({ schedule: { minute: { end: 5 } } })),
        TypeError,
        "Invalid cron schedule: start=undefined, end=5, every=undefined",
      );
    });

    it("skips ticks while the previous run is busy and resumes afterwards", async () => {
      using runtime = simulateRuntime({});
      let finish = (): void => {};

      registerCronJob(runtime.job({
        handler: () => {
          runtime.mark();

          const { promise, resolve } = Promise.withResolvers<void>();

          finish = resolve;

          return promise;
        },
      }));
      await runtime.advance(MINUTE);
      await runtime.advance(MINUTE);

      assertEquals(runtime.runs, ["2026-01-01T00:01:00.000Z"]);

      finish();
      await runtime.advance(MINUTE);

      assertEquals(runtime.runs, [
        "2026-01-01T00:01:00.000Z",
        "2026-01-01T00:03:00.000Z",
      ]);
    });

    it("stops the job when the signal aborts", async () => {
      using runtime = simulateRuntime({});

      registerCronJob(runtime.job());
      await runtime.advance(MINUTE);
      runtime.controller.abort();
      await runtime.advance(5 * MINUTE);

      assertEquals(runtime.runs, ["2026-01-01T00:01:00.000Z"]);
    });
  });

  describe("backoff emulation without Deno.cron", () => {
    it("retries a failed run after each delay in order until it succeeds", async () => {
      using runtime = simulateRuntime({});
      const first = new Error("first");
      const second = new Error("second");

      registerCronJob(runtime.job({
        backoffSchedule: [1_000, 5_000],
        handler: () => {
          runtime.mark();

          if (runtime.runs.length === 1) {
            throw first;
          }

          return runtime.runs.length === 2
            ? Promise.reject(second)
            : Promise.resolve();
        },
      }));
      await runtime.advance(MINUTE);
      await runtime.advance(999);

      assertEquals(runtime.runs.length, 1);

      await runtime.advance(1);
      await runtime.advance(4_999);

      assertEquals(runtime.runs.length, 2);

      await runtime.advance(1);
      await runtime.advance(54_000);

      assertEquals(runtime.runs, [
        "2026-01-01T00:01:00.000Z",
        "2026-01-01T00:01:01.000Z",
        "2026-01-01T00:01:06.000Z",
        "2026-01-01T00:02:00.000Z",
      ]);
      assertSpyCalls(runtime.errors, 2);
      assertSpyCallArgs(runtime.errors, 0, [
        "Exception in cron handler job",
        first,
      ]);
      assertSpyCallArgs(runtime.errors, 1, [
        "Exception in cron handler job",
        second,
      ]);
    });

    it("gives up once the backoff schedule is exhausted", async () => {
      using runtime = simulateRuntime({});

      registerCronJob(runtime.job({
        backoffSchedule: [1_000],
        handler: () => {
          runtime.mark();

          throw new Error("boom");
        },
      }));
      await runtime.advance(MINUTE);
      await runtime.advance(1_000);
      await runtime.advance(58_999);

      assertEquals(runtime.runs, [
        "2026-01-01T00:01:00.000Z",
        "2026-01-01T00:01:01.000Z",
      ]);

      await runtime.advance(1);

      assertEquals(runtime.runs.length, 3);
      assertSpyCalls(runtime.errors, 3);
    });

    it("treats a pending retry as busy and skips ticks meanwhile", async () => {
      using runtime = simulateRuntime({});

      registerCronJob(runtime.job({
        backoffSchedule: [90_000],
        handler: () => {
          runtime.mark();

          if (runtime.runs.length === 1) {
            throw new Error("boom");
          }
        },
      }));
      await runtime.advance(MINUTE);
      await runtime.advance(90_000);
      await runtime.advance(30_000);

      assertEquals(runtime.runs, [
        "2026-01-01T00:01:00.000Z",
        "2026-01-01T00:02:30.000Z",
        "2026-01-01T00:03:00.000Z",
      ]);
    });

    it("applies Deno.cron's default backoff schedule when none is configured", async () => {
      using runtime = simulateRuntime({});

      registerCronJob(runtime.job({
        handler: () => {
          runtime.mark();

          throw new Error("boom");
        },
      }));

      for (const ms of [MINUTE, 100, 1_000, 5_000, 30_000, 60_000, 23_899]) {
        await runtime.advance(ms);
      }

      assertEquals(runtime.runs, [
        "2026-01-01T00:01:00.000Z",
        "2026-01-01T00:01:00.100Z",
        "2026-01-01T00:01:01.100Z",
        "2026-01-01T00:01:06.100Z",
        "2026-01-01T00:01:36.100Z",
        "2026-01-01T00:02:36.100Z",
      ]);
    });

    it("does not retry when the backoff schedule is empty", async () => {
      using runtime = simulateRuntime({});

      registerCronJob(runtime.job({
        backoffSchedule: [],
        handler: () => {
          runtime.mark();

          throw new Error("boom");
        },
      }));
      await runtime.advance(MINUTE);
      await runtime.advance(MINUTE - 1);

      assertEquals(runtime.runs, ["2026-01-01T00:01:00.000Z"]);
      assertSpyCalls(runtime.errors, 1);
    });

    it("abandons a pending retry when the job is aborted", async () => {
      using runtime = simulateRuntime({});

      registerCronJob(runtime.job({
        backoffSchedule: [1_000],
        handler: () => {
          runtime.mark();

          throw new Error("boom");
        },
      }));
      await runtime.advance(MINUTE);
      await runtime.advance(500);
      runtime.controller.abort();
      await runtime.advance(5 * MINUTE);

      assertEquals(runtime.runs, ["2026-01-01T00:01:00.000Z"]);
    });

    it("does not retry a run that aborted its own job", async () => {
      using runtime = simulateRuntime({});

      registerCronJob(runtime.job({
        backoffSchedule: [1_000],
        handler: () => {
          runtime.mark();
          runtime.controller.abort();

          throw new Error("boom");
        },
      }));
      await runtime.advance(MINUTE);
      await runtime.advance(5 * MINUTE);

      assertEquals(runtime.runs, ["2026-01-01T00:01:00.000Z"]);
    });
  });

  describe("name validation without Deno.cron", () => {
    const INVALID_NAME =
      "Invalid cron name: only alphanumeric characters, whitespace, hyphens, and underscores are allowed";

    it("schedules names Deno.cron accepts", async () => {
      using runtime = simulateRuntime({});
      const names = ["job-1_OK", "a b\tc\nd\fe\rf", "a".repeat(64), ""];

      for (const name of names) {
        registerCronJob(runtime.job({ name }));
      }

      await runtime.advance(MINUTE);

      assertEquals(runtime.runs.length, names.length);
    });

    it("rejects names longer than 64 UTF-8 bytes like Deno.cron", () => {
      using runtime = simulateRuntime({});
      const cases: [string, number][] = [
        ["a".repeat(65), 65],
        ["\u00e4".repeat(33), 66],
      ];

      for (const [name, length] of cases) {
        assertThrows(
          () => registerCronJob(runtime.job({ name })),
          TypeError,
          `Cron name cannot exceed 64 characters: current length ${length}`,
        );
      }
    });

    it("rejects characters Deno.cron rejects", () => {
      using runtime = simulateRuntime({});

      for (const name of ["Service.run", "a$b", "a\vb", "\u00e4"]) {
        assertThrows(
          () => registerCronJob(runtime.job({ name })),
          TypeError,
          INVALID_NAME,
        );
      }
    });

    it("reports errors in Deno.cron's order: schedule object, name, pattern", () => {
      using runtime = simulateRuntime({});

      assertThrows(
        () =>
          registerCronJob(
            runtime.job({ name: "a.b", schedule: { minute: { end: 5 } } }),
          ),
        TypeError,
        "Invalid cron schedule",
      );
      assertThrows(
        () => registerCronJob(runtime.job({ name: "a.b", schedule: "nope" })),
        TypeError,
        INVALID_NAME,
      );
    });
  });
});

describe("toCronExpression", () => {
  it("returns cron strings unchanged", () => {
    assertEquals(toCronExpression("*/5 1 * * MON"), "*/5 1 * * MON");
  });

  describe("formats every field expression shape", () => {
    const cases: [CronSchedule, string][] = [
      [{ minute: 5 }, "5 * * * *"],
      [{ minute: { exact: 5 } }, "5 * * * *"],
      [{ minute: { exact: [1, 15, 30] } }, "1,15,30 * * * *"],
      [{ minute: { start: 1, end: 5, every: 2 } }, "1-5/2 * * * *"],
      [{ minute: { start: 1, end: 5 } }, "1-5 * * * *"],
      [{ minute: { start: 5, every: 15 } }, "5/15 * * * *"],
      [{ minute: { start: 5 } }, "5/1 * * * *"],
      [{ minute: { every: 15 } }, "*/15 * * * *"],
    ];

    for (const [schedule, expected] of cases) {
      it(`${JSON.stringify(schedule)} -> "${expected}"`, () => {
        assertEquals(toCronExpression(schedule), expected);
      });
    }
  });

  describe("pins fields below the most significant one like Deno.cron", () => {
    const cases: [CronSchedule, string][] = [
      [{}, "* * * * *"],
      [{ hour: 3 }, "0 3 * * *"],
      [{ dayOfMonth: 15 }, "0 0 15 * *"],
      [{ dayOfWeek: 2 }, "0 0 * * 2"],
      [{ month: 6 }, "0 0 1 6 *"],
      [{ hour: { every: 2 }, month: 6 }, "0 */2 * 6 *"],
      [
        { minute: 30, hour: 4, dayOfMonth: 1, month: 2, dayOfWeek: 3 },
        "30 4 1 2 3",
      ],
    ];

    for (const [schedule, expected] of cases) {
      it(`${JSON.stringify(schedule)} -> "${expected}"`, () => {
        assertEquals(toCronExpression(schedule), expected);
      });
    }
  });

  it("rejects range expressions without start or every", () => {
    const cases: [CronSchedule, string][] = [
      [{ minute: { end: 5 } }, "start=undefined, end=5, every=undefined"],
      [{ hour: { end: 5, every: 2 } }, "start=undefined, end=5, every=2"],
      [{ dayOfWeek: {} }, "start=undefined, end=undefined, every=undefined"],
    ];

    for (const [schedule, detail] of cases) {
      assertThrows(
        () => toCronExpression(schedule),
        TypeError,
        `Invalid cron schedule: ${detail}`,
      );
    }
  });
});
