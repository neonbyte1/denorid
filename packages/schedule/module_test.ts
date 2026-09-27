import { Test } from "@denorid/core/testing";
import {
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@denorid/injector";
import { assertEquals, assertInstanceOf } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { describe, it } from "node:test";
import { cronHost } from "./_cron_runtime.ts";
import { Cron } from "./decorator.ts";
import { ScheduleModule } from "./module.ts";
import { SchedulerRegistry } from "./registry.ts";

interface FakeDenoCron extends Disposable {
  handlers: (() => void | Promise<void>)[];
  signals: (AbortSignal | undefined)[];
}

/**
 * Simulates a runtime whose `Deno.cron` records handlers instead of
 * scheduling them.
 */
function useFakeDenoCron(): FakeDenoCron {
  const originalScope = cronHost.scope;
  const handlers: (() => void | Promise<void>)[] = [];
  const signals: (AbortSignal | undefined)[] = [];

  cronHost.scope = {
    Deno: {
      cron: (_name, _schedule, options, handler): Promise<void> => {
        handlers.push(handler);
        signals.push(options.signal);

        return Promise.resolve();
      },
    },
  };

  return {
    handlers,
    signals,
    [Symbol.dispose](): void {
      cronHost.scope = originalScope;
    },
  };
}

describe(ScheduleModule.name, () => {
  it("exports SchedulerRegistry", async () => {
    const module = await Test.createTestingModule({
      imports: [ScheduleModule],
    })
      .useCoreGlobals()
      .compile();

    try {
      assertInstanceOf(await module.get(SchedulerRegistry), SchedulerRegistry);
    } finally {
      await module.close();
    }
  });

  it("discovers decorated provider methods on bootstrap", async () => {
    const calls: number[] = [];

    @Injectable()
    class TaskService {
      value = 7;

      @Cron("* * * * *")
      run() {
        calls.push(this.value);
      }
    }

    using _cron = useFakeDenoCron();
    const module = await Test.createTestingModule({
      imports: [ScheduleModule],
      providers: [TaskService],
    })
      .useCoreGlobals()
      .compile();

    try {
      await module.init();

      const registry = await module.get(SchedulerRegistry);

      assertInstanceOf(registry.getCronJob("TaskService_run"), Object);
    } finally {
      await module.close();
    }
  });

  it("uses explicit cron name when provided", async () => {
    @Injectable()
    class ReportService {
      @Cron("0 9 * * 1", { name: "weekly-report" })
      generate() {}
    }

    using _cron = useFakeDenoCron();
    const module = await Test.createTestingModule({
      imports: [ScheduleModule],
      providers: [ReportService],
    })
      .useCoreGlobals()
      .compile();

    try {
      await module.init();

      const registry = await module.get(SchedulerRegistry);

      assertInstanceOf(registry.getCronJob("weekly-report"), Object);
    } finally {
      await module.close();
    }
  });

  it("falls back to ClassName_method when name is not specified", async () => {
    @Injectable()
    class CleanupService {
      @Cron("0 0 * * *")
      cleanup() {}
    }

    using _cron = useFakeDenoCron();
    const module = await Test.createTestingModule({
      imports: [ScheduleModule],
      providers: [CleanupService],
    })
      .useCoreGlobals()
      .compile();

    try {
      await module.init();

      const registry = await module.get(SchedulerRegistry);

      assertInstanceOf(registry.getCronJob("CleanupService_cleanup"), Object);
    } finally {
      await module.close();
    }
  });

  it("handler is invoked with provider instance as this", async () => {
    const calls: number[] = [];

    @Injectable()
    class ScopedService {
      value = 99;

      @Cron("* * * * *")
      work() {
        calls.push(this.value);
      }
    }

    using cron = useFakeDenoCron();
    const module = await Test.createTestingModule({
      imports: [ScheduleModule],
      providers: [ScopedService],
    })
      .useCoreGlobals()
      .compile();

    try {
      await module.init();
      await cron.handlers[0]();

      assertEquals(calls[0], 99);
    } finally {
      await module.close();
    }
  });

  it("discovers jobs of nested and non-exported modules", async () => {
    @Injectable()
    class FeatureTasks {
      @Cron("* * * * *", { name: "feature" })
      run() {}
    }

    @Injectable()
    class NestedTasks {
      @Cron("* * * * *", { name: "nested" })
      run() {}
    }

    @Module({ providers: [FeatureTasks] })
    class FeatureModule {}

    @Module({ providers: [NestedTasks], exports: [NestedTasks] })
    class InnerModule {}

    @Module({ imports: [InnerModule] })
    class OuterModule {}

    using _cron = useFakeDenoCron();
    const module = await Test.createTestingModule({
      imports: [ScheduleModule, FeatureModule, OuterModule],
    })
      .useCoreGlobals()
      .compile();

    try {
      await module.init();

      const registry = await module.get(SchedulerRegistry);

      assertEquals([...registry.getCronJobs().keys()].sort(), [
        "feature",
        "nested",
      ]);
    } finally {
      await module.close();
    }
  });

  describe("on shutdown", () => {
    it("stops Deno.cron jobs before other providers are destroyed", async () => {
      let abortedOnDestroy: boolean | undefined;

      @Injectable()
      class TaskService implements OnModuleDestroy {
        @Cron("* * * * *")
        run() {}

        onModuleDestroy(): void {
          abortedOnDestroy = cron.signals[0]?.aborted;
        }
      }

      using cron = useFakeDenoCron();
      const module = await Test.createTestingModule({
        imports: [ScheduleModule],
        providers: [TaskService],
      })
        .useCoreGlobals()
        .compile();

      await module.init();

      const registry = await module.get(SchedulerRegistry);

      await module.close();

      assertEquals(cron.signals.length, 1);
      assertEquals(abortedOnDestroy, true);
      assertEquals(registry.getCronJobs().size, 0);
    });

    it("stops croner jobs and registered intervals and timeouts", async () => {
      const fired: string[] = [];

      @Injectable()
      class TaskService implements OnApplicationBootstrap {
        @Inject(SchedulerRegistry)
        private readonly registry!: SchedulerRegistry;

        @Cron("* * * * *")
        run() {
          fired.push("cron");
        }

        onApplicationBootstrap(): void {
          this.registry.addInterval(
            "poll",
            setInterval(() => fired.push("interval"), 25_000),
          );
          this.registry.addTimeout(
            "later",
            setTimeout(() => fired.push("timeout"), 90_000),
          );
        }
      }

      using time = new FakeTime("2026-01-01T00:00:00.000Z");
      const originalScope = cronHost.scope;

      cronHost.scope = {};

      try {
        const module = await Test.createTestingModule({
          imports: [ScheduleModule],
          providers: [TaskService],
        })
          .useCoreGlobals()
          .compile();

        await module.init();
        await time.tickAsync(60_000);

        assertEquals(fired, ["interval", "interval", "cron"]);

        await module.close();
        await time.tickAsync(5 * 60_000);

        assertEquals(fired, ["interval", "interval", "cron"]);
      } finally {
        cronHost.scope = originalScope;
      }
    });
  });
});
