import type { ModuleRef, Type } from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { CRON_PROVIDER } from "./_constants.ts";
import { ScheduleExplorer } from "./_explorer.ts";
import { CronJobRef } from "./cron_job_ref.ts";
import { Cron } from "./decorator.ts";
import { SchedulerRegistry } from "./registry.ts";

type CronStubArgs = [
  string,
  string | Deno.CronSchedule,
  { signal: AbortSignal; backoffSchedule?: number[] },
  () => void | Promise<void>,
];

interface ExplorerHarness {
  cronCalls: CronStubArgs[];
  registry: SchedulerRegistry;
  explorer: ScheduleExplorer;
  restore: () => void;
}

function createHarness(options: {
  providers?: Type[];
  instances?: Map<Type, unknown>;
}): ExplorerHarness {
  const cronCalls: CronStubArgs[] = [];

  const cronStub = stub(
    Deno,
    "cron",
    (
      name: string,
      schedule: string | Deno.CronSchedule,
      optionsOrHandler:
        | { signal?: AbortSignal; backoffSchedule?: number[] }
        | (() => void | Promise<void>),
      handler?: () => void | Promise<void>,
    ) => {
      const opts = typeof optionsOrHandler === "function"
        ? {}
        : optionsOrHandler;
      const fn = typeof optionsOrHandler === "function"
        ? optionsOrHandler
        : handler!;

      cronCalls.push([
        name,
        schedule,
        opts as { signal: AbortSignal; backoffSchedule?: number[] },
        fn,
      ]);

      return Promise.resolve();
    },
  );

  const moduleRef = {
    get: (token: Type) => {
      if (options.instances?.has(token)) {
        return Promise.resolve(options.instances.get(token));
      }
      throw new Error(`Unexpected token: ${String(token)}`);
    },
    getTokensByTag: (tag: symbol) =>
      tag === CRON_PROVIDER ? (options.providers ?? []) : [],
  } as unknown as ModuleRef;

  const registry = new SchedulerRegistry();
  const explorer = new ScheduleExplorer(moduleRef);

  Object.defineProperty(explorer, "registry", { value: registry });

  return {
    cronCalls,
    registry,
    explorer,
    restore: () => cronStub.restore(),
  };
}

describe(ScheduleExplorer.name, () => {
  describe("onApplicationBootstrap", () => {
    it("does nothing when no providers are tagged with CRON_PROVIDER", async () => {
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

    it("registers a cron job using default ClassName.method name", async () => {
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
        assertEquals(harness.cronCalls[0][0], "TaskService.run");
        assertEquals(harness.cronCalls[0][1], "* * * * *");
        assertEquals(harness.registry.getCronJobs().size, 1);
        assertInstanceOf(
          harness.registry.getCronJob("TaskService.run"),
          CronJobRef,
        );
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
          harness.registry.getCronJob("TaskService.run").backoffSchedule,
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

        const ref = harness.registry.getCronJob("TaskService.run");

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

        harness.registry.deleteCronJob("TaskService.run");

        assertEquals(harness.cronCalls[0][2].signal.aborted, true);
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
          harness.registry.getCronJob("TaskService.first"),
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
          harness.registry.getCronJob("ServiceA.run"),
          CronJobRef,
        );
        assertInstanceOf(
          harness.registry.getCronJob("ServiceB.tick"),
          CronJobRef,
        );
      } finally {
        harness.restore();
      }
    });
  });
});
