import type { ModuleRef, Type } from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { describe, it } from "node:test";
import { SCHEDULE_PROVIDER } from "./_constants.ts";
import { cronHost, type CronHostScope } from "./_cron_runtime.ts";
import { ScheduleExplorer } from "./_explorer.ts";
import { CronJobRef } from "./cron_job_ref.ts";
import type { CronSchedule } from "./cron_schedule.ts";
import { Cron } from "./decorator.ts";
import { SchedulerItemAlreadyExistsException } from "./exceptions.ts";
import { SchedulerRegistry } from "./registry.ts";

type DenoCronArgs = [
  string,
  string | CronSchedule,
  { signal?: AbortSignal; backoffSchedule?: number[] },
  () => void | Promise<void>,
];

interface ExplorerHarness {
  cronCalls: DenoCronArgs[];
  registry: SchedulerRegistry;
  explorer: ScheduleExplorer;
  restore: () => void;
}

/**
 * Builds an explorer over a fake module graph. Unless `scope` is given, the
 * simulated runtime exposes a `Deno.cron` that records its calls.
 */
function createHarness(options: {
  providers?: Type[];
  instances?: Map<Type, unknown>;
  scope?: CronHostScope;
}): ExplorerHarness {
  const cronCalls: DenoCronArgs[] = [];
  const originalScope = cronHost.scope;

  cronHost.scope = options.scope ?? {
    Deno: {
      cron: (...args: DenoCronArgs): Promise<void> => {
        cronCalls.push(args);

        return Promise.resolve();
      },
    },
  };

  const moduleRef = {
    get: (token: Type) => {
      if (options.instances?.has(token)) {
        return Promise.resolve(options.instances.get(token));
      }
      throw new Error(`Unexpected token: ${String(token)}`);
    },
    getTokensByTag: (tag: symbol) =>
      tag === SCHEDULE_PROVIDER ? (options.providers ?? []) : [],
  } as unknown as ModuleRef;

  const registry = new SchedulerRegistry();
  const explorer = new ScheduleExplorer(moduleRef);

  Object.defineProperty(explorer, "registry", { value: registry });

  return {
    cronCalls,
    registry,
    explorer,
    restore: () => {
      cronHost.scope = originalScope;
    },
  };
}

describe(ScheduleExplorer.name, () => {
  describe("onApplicationBootstrap", () => {
    it("does nothing when no providers are tagged with SCHEDULE_PROVIDER", async () => {
      const harness = createHarness({});

      try {
        await harness.explorer.onApplicationBootstrap();

        assertEquals(harness.cronCalls.length, 0);
        assertEquals(harness.registry.getCronJobs().size, 0);
      } finally {
        harness.restore();
      }
    });

    it("skips providers without cron metadata", async () => {
      class NoMeta {}

      Object.defineProperty(NoMeta, Symbol.metadata, { value: {} });

      const harness = createHarness({ providers: [NoMeta] });

      try {
        await harness.explorer.onApplicationBootstrap();

        assertEquals(harness.cronCalls.length, 0);
      } finally {
        harness.restore();
      }
    });

    it("registers a cron job using default ClassName_method name", async () => {
      class TaskService {
        @Cron("* * * * *")
        run() {}
      }

      const instance = new TaskService();
      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, instance]]),
      });

      try {
        await harness.explorer.onApplicationBootstrap();

        assertEquals(harness.cronCalls.length, 1);
        assertEquals(harness.cronCalls[0][0], "TaskService_run");
        assertEquals(harness.cronCalls[0][1], "* * * * *");
        assertEquals(harness.registry.getCronJobs().size, 1);
        assertInstanceOf(
          harness.registry.getCronJob("TaskService_run"),
          CronJobRef,
        );
      } finally {
        harness.restore();
      }
    });

    it("replaces characters Deno.cron rejects in default names", async () => {
      const tick = Symbol("tick");

      class Task$Service {
        @Cron("* * * * *")
        ["daily.report"]() {}

        @Cron("* * * * *")
        ["nightly run-1"]() {}

        @Cron("* * * * *")
        [tick]() {}
      }

      const harness = createHarness({
        providers: [Task$Service],
        instances: new Map([[Task$Service, new Task$Service()]]),
      });

      try {
        await harness.explorer.onApplicationBootstrap();

        assertEquals(harness.cronCalls.map(([name]) => name), [
          "Task_Service_daily_report",
          "Task_Service_nightly run-1",
          "Task_Service_Symbol_tick_",
        ]);
        assertEquals([...harness.registry.getCronJobs().keys()], [
          "Task_Service_daily_report",
          "Task_Service_nightly run-1",
          "Task_Service_Symbol_tick_",
        ]);
      } finally {
        harness.restore();
      }
    });

    it("uses explicit name from decorator options", async () => {
      class TaskService {
        @Cron("0 * * * *", { name: "hourly" })
        run() {}
      }

      const instance = new TaskService();
      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, instance]]),
      });

      try {
        await harness.explorer.onApplicationBootstrap();

        assertEquals(harness.cronCalls[0][0], "hourly");
        assertInstanceOf(harness.registry.getCronJob("hourly"), CronJobRef);
      } finally {
        harness.restore();
      }
    });

    it("forwards backoffSchedule to Deno.cron options", async () => {
      class TaskService {
        @Cron("* * * * *", { backoffSchedule: [500, 2000] })
        run() {}
      }

      const instance = new TaskService();
      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, instance]]),
      });

      try {
        await harness.explorer.onApplicationBootstrap();

        assertEquals(harness.cronCalls[0][2].backoffSchedule, [500, 2000]);
        assertEquals(
          harness.registry.getCronJob("TaskService_run").backoffSchedule,
          [500, 2000],
        );
      } finally {
        harness.restore();
      }
    });

    it("passes the AbortController signal to Deno.cron", async () => {
      class TaskService {
        @Cron("* * * * *")
        run() {}
      }

      const instance = new TaskService();
      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, instance]]),
      });

      try {
        await harness.explorer.onApplicationBootstrap();

        const ref = harness.registry.getCronJob("TaskService_run");

        assertStrictEquals(
          harness.cronCalls[0][2].signal,
          ref.controller.signal,
        );
      } finally {
        harness.restore();
      }
    });

    it("invokes the handler bound to the provider instance", async () => {
      const calls: unknown[] = [];

      class TaskService {
        value = 42;

        @Cron("* * * * *")
        run() {
          calls.push(this.value);
        }
      }

      const instance = new TaskService();
      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, instance]]),
      });

      try {
        await harness.explorer.onApplicationBootstrap();

        const [, , , handler] = harness.cronCalls[0];

        await handler();

        assertEquals(calls, [42]);
      } finally {
        harness.restore();
      }
    });

    it("aborting the registry job aborts the cron signal", async () => {
      class TaskService {
        @Cron("* * * * *")
        run() {}
      }

      const instance = new TaskService();
      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, instance]]),
      });

      try {
        await harness.explorer.onApplicationBootstrap();

        harness.registry.deleteCronJob("TaskService_run");

        assertEquals(harness.cronCalls[0][2].signal?.aborted, true);
      } finally {
        harness.restore();
      }
    });

    it("registers multiple methods from one provider", async () => {
      class TaskService {
        @Cron("* * * * *")
        first() {}

        @Cron("0 0 * * *", { name: "daily" })
        second() {}
      }

      const instance = new TaskService();
      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, instance]]),
      });

      try {
        await harness.explorer.onApplicationBootstrap();

        assertEquals(harness.cronCalls.length, 2);
        assertEquals(harness.registry.getCronJobs().size, 2);
        assertInstanceOf(
          harness.registry.getCronJob("TaskService_first"),
          CronJobRef,
        );
        assertInstanceOf(
          harness.registry.getCronJob("daily"),
          CronJobRef,
        );
      } finally {
        harness.restore();
      }
    });

    it("registers cron jobs from multiple providers", async () => {
      class ServiceA {
        @Cron("* * * * *")
        run() {}
      }

      class ServiceB {
        @Cron("0 * * * *")
        tick() {}
      }

      const harness = createHarness({
        providers: [ServiceA, ServiceB],
        instances: new Map<Type, unknown>([
          [ServiceA, new ServiceA()],
          [ServiceB, new ServiceB()],
        ]),
      });

      try {
        await harness.explorer.onApplicationBootstrap();

        assertEquals(harness.cronCalls.length, 2);
        assertInstanceOf(
          harness.registry.getCronJob("ServiceA_run"),
          CronJobRef,
        );
        assertInstanceOf(
          harness.registry.getCronJob("ServiceB_tick"),
          CronJobRef,
        );
      } finally {
        harness.restore();
      }
    });

    it("stops the new job when its name is already registered", async () => {
      class TaskService {
        @Cron("* * * * *")
        run() {}
      }

      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, new TaskService()]]),
      });
      const existing = new CronJobRef({
        name: "TaskService_run",
        schedule: "0 * * * *",
        handler: () => {},
        controller: new AbortController(),
      });

      harness.registry.addCronJob("TaskService_run", existing);

      try {
        await assertRejects(
          () => harness.explorer.onApplicationBootstrap(),
          SchedulerItemAlreadyExistsException,
        );

        assertEquals(harness.cronCalls[0][2].signal?.aborted, true);
        assertStrictEquals(
          harness.registry.getCronJob("TaskService_run"),
          existing,
        );
        assertEquals(existing.controller.signal.aborted, false);
      } finally {
        harness.restore();
      }
    });

    it("runs jobs with croner when the runtime has no Deno.cron", async () => {
      const calls: number[] = [];

      class TaskService {
        value = 7;

        @Cron("* * * * *")
        run() {
          calls.push(this.value);
        }
      }

      using time = new FakeTime("2026-01-01T00:00:00.000Z");
      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, new TaskService()]]),
        scope: {},
      });

      try {
        await harness.explorer.onApplicationBootstrap();
        await time.tickAsync(60_000);

        assertEquals(calls, [7]);

        harness.registry.deleteCronJob("TaskService_run");
        await time.tickAsync(5 * 60_000);

        assertEquals(calls, [7]);
      } finally {
        harness.restore();
      }
    });

    it("rejects explicit names Deno.cron would reject when using croner", async () => {
      class TaskService {
        @Cron("* * * * *", { name: "reports.daily" })
        run() {}
      }

      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, new TaskService()]]),
        scope: {},
      });

      try {
        await assertRejects(
          () => harness.explorer.onApplicationBootstrap(),
          TypeError,
          "Invalid cron name",
        );

        assertEquals(harness.registry.getCronJobs().size, 0);
      } finally {
        harness.restore();
      }
    });

    it("stops the jobs it registered when a later registration fails", async () => {
      const calls: string[] = [];

      class TaskService {
        @Cron("* * * * *")
        first() {
          calls.push("first");
        }

        @Cron("* * * * *", { name: "reports.daily" })
        second() {
          calls.push("second");
        }
      }

      using time = new FakeTime("2026-01-01T00:00:00.000Z");
      const harness = createHarness({
        providers: [TaskService],
        instances: new Map([[TaskService, new TaskService()]]),
        scope: {},
      });
      const existing = new CronJobRef({
        name: "existing",
        schedule: "* * * * *",
        handler: () => {},
        controller: new AbortController(),
      });

      harness.registry.addCronJob("existing", existing);

      try {
        await assertRejects(
          () => harness.explorer.onApplicationBootstrap(),
          TypeError,
          "Invalid cron name",
        );
        await time.tickAsync(5 * 60_000);

        assertEquals(calls, []);
        assertEquals([...harness.registry.getCronJobs().keys()], ["existing"]);
        assertEquals(existing.controller.signal.aborted, false);
      } finally {
        harness.restore();
      }
    });
  });
});
