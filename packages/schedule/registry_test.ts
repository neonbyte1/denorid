import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
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
    it("adds, gets, lists, and deletes an interval", () => {
      const registry = new SchedulerRegistry();
      const id = 42 as unknown as number;

      registry.addInterval("my-interval", id);

      assertEquals(registry.getInterval("my-interval"), id);
      assertEquals(registry.getIntervals(), ["my-interval"]);

      registry.deleteInterval("my-interval");

      assertEquals(registry.getIntervals(), []);
    });

    it("throws when adding a duplicate interval name", () => {
      const registry = new SchedulerRegistry();

      registry.addInterval("dup", 1 as unknown as number);

      assertThrows(
        () => registry.addInterval("dup", 2 as unknown as number),
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
    it("adds, gets, lists, and deletes a timeout", () => {
      const registry = new SchedulerRegistry();
      const id = 99 as unknown as number;

      registry.addTimeout("my-timeout", id);

      assertEquals(registry.getTimeout("my-timeout"), id);
      assertEquals(registry.getTimeouts(), ["my-timeout"]);

      registry.deleteTimeout("my-timeout");

      assertEquals(registry.getTimeouts(), []);
    });

    it("throws when adding a duplicate timeout name", () => {
      const registry = new SchedulerRegistry();

      registry.addTimeout("dup", 1 as unknown as number);

      assertThrows(
        () => registry.addTimeout("dup", 2 as unknown as number),
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
});
