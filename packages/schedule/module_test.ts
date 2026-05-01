import { Test } from "@denorid/core/testing";
import { Injectable } from "@denorid/injector";
import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { Cron } from "./decorator.ts";
import { ScheduleModule } from "./module.ts";
import { SchedulerRegistry } from "./registry.ts";

describe(ScheduleModule.name, () => {
  it("exports SchedulerRegistry", async () => {
    const cronStub = stub(Deno, "cron", () => Promise.resolve());
    const module = await Test.createTestingModule({
      imports: [ScheduleModule],
    })
      .useCoreGlobals()
      .compile();

    try {
      assertInstanceOf(await module.get(SchedulerRegistry), SchedulerRegistry);
    } finally {
      await module.close();
      cronStub.restore();
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

    const cronStub = stub(Deno, "cron", () => Promise.resolve());
    const module = await Test.createTestingModule({
      imports: [ScheduleModule],
      providers: [TaskService],
    })
      .useCoreGlobals()
      .compile();

    try {
      await module.init();

      const registry = await module.get(SchedulerRegistry);

      assertInstanceOf(registry.getCronJob("TaskService.run"), Object);
    } finally {
      await module.close();
      cronStub.restore();
    }
  });

  it("uses explicit cron name when provided", async () => {
    @Injectable()
    class ReportService {
      @Cron("0 9 * * 1", { name: "weekly-report" })
      generate() {}
    }

    const cronStub = stub(Deno, "cron", () => Promise.resolve());
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
      cronStub.restore();
    }
  });

  it("falls back to ClassName.method when name is not specified", async () => {
    @Injectable()
    class CleanupService {
      @Cron("0 0 * * *")
      cleanup() {}
    }

    const cronStub = stub(Deno, "cron", () => Promise.resolve());
    const module = await Test.createTestingModule({
      imports: [ScheduleModule],
      providers: [CleanupService],
    })
      .useCoreGlobals()
      .compile();

    try {
      await module.init();

      const registry = await module.get(SchedulerRegistry);

      assertInstanceOf(registry.getCronJob("CleanupService.cleanup"), Object);
    } finally {
      await module.close();
      cronStub.restore();
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

    let capturedHandler: (() => void | Promise<void>) | undefined;

    const cronStub = stub(
      Deno,
      "cron",
      (
        _name: string,
        _schedule: string | Deno.CronSchedule,
        optionsOrHandler:
          | { signal?: AbortSignal }
          | (() => void | Promise<void>),
        handler?: () => void | Promise<void>,
      ) => {
        capturedHandler = typeof optionsOrHandler === "function"
          ? optionsOrHandler
          : handler!;

        return Promise.resolve();
      },
    );

    const module = await Test.createTestingModule({
      imports: [ScheduleModule],
      providers: [ScopedService],
    })
      .useCoreGlobals()
      .compile();

    try {
      await module.init();
      await capturedHandler!();

      assertEquals(calls[0], 99);
    } finally {
      await module.close();
      cronStub.restore();
    }
  });
});
