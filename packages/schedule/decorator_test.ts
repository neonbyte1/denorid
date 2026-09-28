import {
  InvalidStaticMemberDecoratorUsageError,
  TAG_METADATA,
} from "@denorid/injector";
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import {
  CRON_METADATA,
  INTERVAL_METADATA,
  SCHEDULE_PROVIDER,
} from "./_constants.ts";
import type { CronMetadata, IntervalMetadata } from "./_metadata.ts";
import type { CronSchedule } from "./cron_schedule.ts";
import { Cron, Interval } from "./decorator.ts";

/** A decorated class: TypeScript types `Symbol.metadata` on every class. */
type Decorated = { [Symbol.metadata]: DecoratorMetadataObject | null };

function getCronMetadata(target: Decorated): CronMetadata[] {
  return target[Symbol.metadata]?.[CRON_METADATA] as CronMetadata[];
}

function getIntervalMetadata(target: Decorated): IntervalMetadata[] {
  return target[Symbol.metadata]?.[INTERVAL_METADATA] as IntervalMetadata[];
}

function getTags(target: Decorated): unknown[] {
  return target[Symbol.metadata]?.[TAG_METADATA] as unknown[];
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

  it("stores CronSchedule metadata", () => {
    const schedule: CronSchedule = { minute: { every: 5 } };

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

  it("leaves name undefined when not provided, deferring ClassName_method to bootstrap", () => {
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

  it("tags the class with SCHEDULE_PROVIDER", () => {
    class Service {
      @Cron("* * * * *")
      run() {}
    }

    assertEquals(getTags(Service), [SCHEDULE_PROVIDER]);
  });

  it("deduplicates SCHEDULE_PROVIDER tag when multiple methods are decorated", () => {
    class Service {
      @Cron("* * * * *")
      first() {}

      @Cron("0 * * * *")
      second() {}
    }

    assertEquals(getTags(Service), [SCHEDULE_PROVIDER]);
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

describe(Interval.name, () => {
  it("stores delay, method and name metadata", () => {
    class Service {
      @Interval(10_000)
      heartbeat() {}

      @Interval(30_000, { name: "sweep" })
      sweep() {}
    }

    assertEquals(getIntervalMetadata(Service), [
      { ms: 10_000, method: "heartbeat", name: undefined },
      { ms: 30_000, method: "sweep", name: "sweep" },
    ]);
  });

  it("coerces empty string name to undefined", () => {
    class Service {
      @Interval(1_000, { name: "" })
      run() {}
    }

    assertEquals(getIntervalMetadata(Service)[0].name, undefined);
  });

  it("keeps cron and interval metadata apart under one SCHEDULE_PROVIDER tag", () => {
    class Service {
      @Cron("* * * * *")
      @Interval(5_000)
      run() {}
    }

    assertEquals(getTags(Service), [SCHEDULE_PROVIDER]);
    assertEquals(getCronMetadata(Service).length, 1);
    assertEquals(getIntervalMetadata(Service), [
      { ms: 5_000, method: "run", name: undefined },
    ]);
  });

  it("accepts the smallest and largest timer delays", () => {
    class Service {
      @Interval(1)
      fastest() {}

      @Interval(2_147_483_647)
      slowest() {}
    }

    assertEquals(getIntervalMetadata(Service).map(({ ms }) => ms), [
      1,
      2_147_483_647,
    ]);
  });

  for (const ms of [0, -1, 1.5, 2_147_483_648, Number.NaN, Infinity]) {
    it(`rejects ${ms} ms, which timers would run almost continuously`, () => {
      const error = assertThrows(() => Interval(ms), RangeError);

      assertEquals(
        error.message,
        `Invalid interval delay ${ms}: expected an integer from 1 to 2147483647 ms.`,
      );
    });
  }

  it("throws when applied to a static method", () => {
    const error = assertThrows(
      () => {
        class Service {
          @Interval(1_000)
          static run() {}
        }

        return Service;
      },
      InvalidStaticMemberDecoratorUsageError,
    );

    assertEquals(
      error.message,
      'Decorator @Interval() cannot be applied to static function "run".',
    );
  });
});
