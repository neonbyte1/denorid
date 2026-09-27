import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { describe, it } from "node:test";
import { CronJobRef } from "./cron_job_ref.ts";
import {
  SchedulerItemAlreadyExistsException,
  SchedulerItemNotFoundException,
} from "./exceptions.ts";
import { SchedulerRegistry } from "./registry.ts";

function makeRef(name: string): CronJobRef {
  return new CronJobRef({
    name,
    schedule: "* * * * *",
    handler: () => {},
    controller: new AbortController(),
  });
}

describe(SchedulerRegistry.name, () => {
  describe("intervals", () => {
    it("adds, gets, lists, and deletes an interval, clearing it", () => {
      using time = new FakeTime();
      const registry = new SchedulerRegistry();
      let ticks = 0;
      const handle = setInterval(() => ticks++, 1_000);

      registry.addInterval("my-interval", handle);

      assertStrictEquals(registry.getInterval("my-interval"), handle);
      assertEquals(registry.getIntervals(), ["my-interval"]);

      time.tick(1_000);
      registry.deleteInterval("my-interval");
      time.tick(5_000);

      assertEquals(ticks, 1);
      assertEquals(registry.getIntervals(), []);
    });

    it("throws when adding a duplicate interval name", () => {
      using _time = new FakeTime();
      const registry = new SchedulerRegistry();

      registry.addInterval("dup", setInterval(() => {}, 1_000));

      assertThrows(
        () => registry.addInterval("dup", setInterval(() => {}, 1_000)),
        SchedulerItemAlreadyExistsException,
        'Interval "dup" is already registered.',
      );
    });

    it("throws when getting a missing interval", () => {
      const registry = new SchedulerRegistry();

      assertThrows(
        () => registry.getInterval("missing"),
        SchedulerItemNotFoundException,
        'Interval "missing" not found.',
      );
    });

    it("throws when deleting a missing interval", () => {
      const registry = new SchedulerRegistry();

      assertThrows(
        () => registry.deleteInterval("missing"),
        SchedulerItemNotFoundException,
        'Interval "missing" not found.',
      );
    });
  });

  describe("timeouts", () => {
    it("adds, gets, lists, and deletes a timeout, clearing it", () => {
      using time = new FakeTime();
      const registry = new SchedulerRegistry();
      let fired = false;
      const handle = setTimeout(() => {
        fired = true;
      }, 1_000);

      registry.addTimeout("my-timeout", handle);

      assertStrictEquals(registry.getTimeout("my-timeout"), handle);
      assertEquals(registry.getTimeouts(), ["my-timeout"]);

      registry.deleteTimeout("my-timeout");
      time.tick(5_000);

      assertEquals(fired, false);
      assertEquals(registry.getTimeouts(), []);
    });

    it("throws when adding a duplicate timeout name", () => {
      using _time = new FakeTime();
      const registry = new SchedulerRegistry();

      registry.addTimeout("dup", setTimeout(() => {}, 1_000));

      assertThrows(
        () => registry.addTimeout("dup", setTimeout(() => {}, 1_000)),
        SchedulerItemAlreadyExistsException,
        'Timeout "dup" is already registered.',
      );
    });

    it("throws when getting a missing timeout", () => {
      const registry = new SchedulerRegistry();

      assertThrows(
        () => registry.getTimeout("missing"),
        SchedulerItemNotFoundException,
        'Timeout "missing" not found.',
      );
    });

    it("throws when deleting a missing timeout", () => {
      const registry = new SchedulerRegistry();

      assertThrows(
        () => registry.deleteTimeout("missing"),
        SchedulerItemNotFoundException,
        'Timeout "missing" not found.',
      );
    });
  });

  describe("cron jobs", () => {
    it("adds, gets, lists, and deletes a cron job", () => {
      const registry = new SchedulerRegistry();
      const ref = makeRef("my-job");

      registry.addCronJob("my-job", ref);

      assertEquals(registry.getCronJob("my-job"), ref);
      assertEquals(registry.getCronJobs().size, 1);

      registry.deleteCronJob("my-job");

      assertEquals(registry.getCronJobs().size, 0);
    });

    it("aborts the controller when deleting a cron job", () => {
      const registry = new SchedulerRegistry();
      const ref = makeRef("abort-job");

      registry.addCronJob("abort-job", ref);
      registry.deleteCronJob("abort-job");

      assertEquals(ref.controller.signal.aborted, true);
    });

    it("throws when adding a duplicate cron job name", () => {
      const registry = new SchedulerRegistry();

      registry.addCronJob("dup", makeRef("dup"));

      assertThrows(
        () => registry.addCronJob("dup", makeRef("dup")),
        SchedulerItemAlreadyExistsException,
        'CronJob "dup" is already registered.',
      );
    });

    it("throws when getting a missing cron job", () => {
      const registry = new SchedulerRegistry();

      assertThrows(
        () => registry.getCronJob("missing"),
        SchedulerItemNotFoundException,
        'CronJob "missing" not found.',
      );
    });

    it("throws when deleting a missing cron job", () => {
      const registry = new SchedulerRegistry();

      assertThrows(
        () => registry.deleteCronJob("missing"),
        SchedulerItemNotFoundException,
        'CronJob "missing" not found.',
      );
    });

    it("getCronJobs returns the live map", () => {
      const registry = new SchedulerRegistry();
      const ref = makeRef("live-map");

      registry.addCronJob("live-map", ref);

      const map = registry.getCronJobs();

      assertEquals(map.get("live-map"), ref);
    });
  });

  describe("onBeforeApplicationShutdown", () => {
    it("stops and forgets every cron job, interval and timeout", () => {
      using time = new FakeTime();
      const registry = new SchedulerRegistry();
      const fired: string[] = [];
      const jobs = [makeRef("job-a"), makeRef("job-b")];

      registry.addInterval("interval", setInterval(() => fired.push("i"), 10));
      registry.addTimeout("timeout", setTimeout(() => fired.push("t"), 10));

      for (const job of jobs) {
        registry.addCronJob(job.name, job);
      }

      registry.onBeforeApplicationShutdown();
      registry.onBeforeApplicationShutdown();
      time.tick(1_000);

      assertEquals(fired, []);
      assertEquals(jobs.map((job) => job.controller.signal.aborted), [
        true,
        true,
      ]);
      assertEquals(registry.getIntervals(), []);
      assertEquals(registry.getTimeouts(), []);
      assertEquals(registry.getCronJobs().size, 0);
    });
  });
});
