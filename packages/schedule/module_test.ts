import { Test } from "@denorid/core/testing";
import { Injectable } from "@denorid/injector";
import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "node:test";
import { cronHost } from "./_cron_runtime.ts";
import { Cron } from "./decorator.ts";
import { ScheduleModule } from "./module.ts";
import { SchedulerRegistry } from "./registry.ts";

interface FakeDenoCron extends Disposable {
  handlers: (() => void | Promise<void>)[];
}

/**
 * Simulates a runtime whose `Deno.cron` records handlers instead of
 * scheduling them.
 */
function useFakeDenoCron(): FakeDenoCron {
  const originalScope = cronHost.scope;
  const handlers: (() => void | Promise<void>)[] = [];

  cronHost.scope = {
    Deno: {
      cron: (_name, _schedule, _options, handler): Promise<void> => {
        handlers.push(handler);

        return Promise.resolve();
      },
    },
  };

  return {
    handlers,
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
});
