import {
  InvalidStaticMemberDecoratorUsageError,
  TAG_METADATA,
} from "@denorid/injector";
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CRON_METADATA, CRON_PROVIDER } from "./_constants.ts";
import type { CronMetadata } from "./_metadata.ts";
import { Cron } from "./decorator.ts";

function getCronMetadata(target: object): CronMetadata[] {
  return (target as { [Symbol.metadata]: Record<symbol, unknown> })[
    Symbol.metadata
  ]![CRON_METADATA] as CronMetadata[];
}

function getTags(target: object): unknown[] {
  return (target as { [Symbol.metadata]: Record<symbol, unknown> })[
    Symbol.metadata
  ]![TAG_METADATA] as unknown[];
}

describe(Cron.name, () => {
  it("stores string schedule metadata", () => {
    class Service {
      @Cron("* * * * *")
      run() {}
    }

    assertEquals(getCronMetadata(Service), [
      {
        schedule: "* * * * *",
        method: "run",
        name: undefined,
        backoffSchedule: undefined,
      },
    ]);
  });

  it("stores Deno.CronSchedule metadata", () => {
    const schedule: Deno.CronSchedule = { minute: { every: 5 } };

    class Service {
      @Cron(schedule)
      run() {}
    }

    assertEquals(getCronMetadata(Service), [
      {
        schedule,
        method: "run",
        name: undefined,
        backoffSchedule: undefined,
      },
    ]);
  });

  it("stores explicit name option", () => {
    class Service {
      @Cron("0 * * * *", { name: "hourly" })
      run() {}
    }

    assertEquals(getCronMetadata(Service), [
      {
        schedule: "0 * * * *",
        method: "run",
        name: "hourly",
        backoffSchedule: undefined,
      },
    ]);
  });

  it("stores backoffSchedule option", () => {
    class Service {
      @Cron("* * * * *", { backoffSchedule: [1000, 5000] })
      run() {}
    }

    assertEquals(getCronMetadata(Service), [
      {
        schedule: "* * * * *",
        method: "run",
        name: undefined,
        backoffSchedule: [1000, 5000],
      },
    ]);
  });

  it("coerces empty string name to undefined", () => {
    class Service {
      @Cron("* * * * *", { name: "" })
      run() {}
    }

    assertEquals(getCronMetadata(Service)[0].name, undefined);
  });

  it("leaves name undefined when not provided, deferring ClassName.method to bootstrap", () => {
    class Service {
      @Cron("* * * * *")
      run() {}
    }

    assertEquals(getCronMetadata(Service)[0].name, undefined);
  });

  it("accumulates metadata for multiple decorated methods", () => {
    class Service {
      @Cron("* * * * *")
      first() {}

      @Cron("0 0 * * *", { name: "daily" })
      second() {}
    }

    assertEquals(getCronMetadata(Service), [
      {
        schedule: "* * * * *",
        method: "first",
        name: undefined,
        backoffSchedule: undefined,
      },
      {
        schedule: "0 0 * * *",
        method: "second",
        name: "daily",
        backoffSchedule: undefined,
      },
    ]);
  });

  it("tags the class with CRON_PROVIDER", () => {
    class Service {
      @Cron("* * * * *")
      run() {}
    }

    assertEquals(getTags(Service), [CRON_PROVIDER]);
  });

  it("deduplicates CRON_PROVIDER tag when multiple methods are decorated", () => {
    class Service {
      @Cron("* * * * *")
      first() {}

      @Cron("0 * * * *")
      second() {}
    }

    assertEquals(getTags(Service), [CRON_PROVIDER]);
  });

  it("throws when applied to a static method", () => {
    const error = assertThrows(
      () => {
        class Service {
          @Cron("* * * * *")
          static run() {}
        }

        return Service;
      },
      InvalidStaticMemberDecoratorUsageError,
    );

    assertEquals(
      error.message,
      'Decorator @Cron() cannot be applied to static function "run".',
    );
  });
});
