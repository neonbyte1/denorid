import { Cron as Croner } from "@hexagon/croner";
import type { CronSchedule, CronScheduleExpression } from "./cron_schedule.ts";

/**
 * Retry delays (milliseconds) `Deno.cron()` applies when no backoff schedule
 * is configured. The croner fallback uses the same default.
 */
export const DEFAULT_BACKOFF_SCHEDULE: readonly number[] = [
  100,
  1_000,
  5_000,
  30_000,
  60_000,
];

/**
 * Characters `Deno.cron()` accepts in job names: ASCII alphanumerics, ASCII
 * whitespace (Rust's `is_ascii_whitespace`), `-` and `_`.
 */
const VALID_CRON_NAME = /^[A-Za-z0-9_\- \t\n\f\r]*$/;

/**
 * A cron job to register with the scheduling backend of the current runtime.
 */
export interface CronJobSpec {
  /** Unique job name. */
  name: string;

  /** Cron expression or structured schedule, evaluated in UTC. */
  schedule: string | CronSchedule;

  /** Function invoked on every scheduled run. */
  handler: () => void | Promise<void>;

  /** Aborting this signal stops the job. */
  signal: AbortSignal;

  /** Retry delays (milliseconds) applied after a failed run. */
  backoffSchedule?: number[];
}

/**
 * Subset of the `Deno` namespace needed to register native cron jobs.
 */
export interface DenoCronNamespace {
  /** `Deno.cron()`, only present on Deno with `--unstable-cron` or Deploy. */
  cron?: (
    name: string,
    schedule: string | CronSchedule,
    options: { backoffSchedule?: number[]; signal?: AbortSignal },
    handler: () => void | Promise<void>,
  ) => Promise<void>;
}

/**
 * Subset of the global scope inspected to pick the scheduling backend.
 */
export interface CronHostScope {
  /** The `Deno` namespace, absent on Bun and Node.js. */
  Deno?: DenoCronNamespace;
}

/**
 * Global scope inspected on every registration. Tests replace `scope` to
 * simulate runtimes with or without `Deno.cron()`.
 */
export const cronHost: { scope: CronHostScope } = {
  scope: globalThis as CronHostScope,
};

/**
 * Registers a cron job with `Deno.cron()` when the runtime provides it,
 * otherwise schedules it with croner using `Deno.cron()` semantics (name
 * rules, UTC, no overlapping runs, backoff retries, stop on abort).
 *
 * @param {CronJobSpec} job - The job to register.
 * @return {void}
 * @throws {TypeError} When the name or the schedule is invalid.
 */
export function registerCronJob(job: CronJobSpec): void {
  const deno = cronHost.scope.Deno;

  if (typeof deno?.cron === "function") {
    deno.cron(
      job.name,
      job.schedule,
      { signal: job.signal, backoffSchedule: job.backoffSchedule },
      job.handler,
    );

    return;
  }

  // Same validation order as Deno.cron: schedule conversion, name, pattern.
  const expression = toCronExpression(job.schedule);

  validateCronName(job.name);

  // Like Deno.cron, a tick that arrives while the previous run (including its
  // backoff retries) is still busy is skipped, not caught up later. croner's
  // own `protect` option would fire the skipped tick up to 30 seconds late.
  let busy = false;
  const croner = new Croner(
    expression,
    {
      timezone: "UTC",
      mode: "5-part",
      alternativeWeekdays: true,
      sloppyRanges: true,
    },
    async () => {
      if (busy) {
        return;
      }

      busy = true;

      try {
        await runWithBackoff(job);
      } finally {
        busy = false;
      }
    },
  );

  job.signal.addEventListener("abort", () => croner.stop(), { once: true });
}

/**
 * Mirrors `validate_cron_name` of Deno's `ext/cron` (limit in UTF-8 bytes,
 * identical messages) so a name accepted on Bun or Node.js is also accepted
 * by `Deno.cron()`.
 */
function validateCronName(name: string): void {
  const length = new TextEncoder().encode(name).length;

  if (length > 64) {
    throw new TypeError(
      `Cron name cannot exceed 64 characters: current length ${length}`,
    );
  }

  if (!VALID_CRON_NAME.test(name)) {
    throw new TypeError(
      "Invalid cron name: only alphanumeric characters, whitespace, hyphens, and underscores are allowed",
    );
  }
}

/**
 * Converts a schedule to the 5-field cron expression `Deno.cron()` would
 * derive from it. Strings are returned unchanged.
 *
 * @param {string | CronSchedule} schedule - Cron expression or structured schedule.
 * @return {string}
 * @throws {TypeError} When a field only sets `end` or sets nothing at all.
 */
export function toCronExpression(schedule: string | CronSchedule): string {
  if (typeof schedule === "string") {
    return schedule;
  }

  let minute = schedule.minute;
  let hour = schedule.hour;
  let dayOfMonth = schedule.dayOfMonth;

  if (minute === undefined) {
    if (hour !== undefined) {
      minute = 0;
    } else if (
      dayOfMonth !== undefined || schedule.dayOfWeek !== undefined
    ) {
      minute = 0;
      hour = 0;
    } else if (schedule.month !== undefined) {
      minute = 0;
      hour = 0;
      dayOfMonth = 1;
    }
  }

  return [minute, hour, dayOfMonth, schedule.month, schedule.dayOfWeek]
    .map(formatField)
    .join(" ");
}

/**
 * Mirrors `formatToCronSchedule` of Deno's `ext/cron` so both backends see
 * the same expression.
 */
function formatField(value: CronScheduleExpression | undefined): string {
  if (value === undefined) {
    return "*";
  }

  if (typeof value === "number") {
    return String(value);
  }

  const { exact } = value as { exact?: number | number[] };

  if (exact !== undefined) {
    return Array.isArray(exact) ? exact.join(",") : String(exact);
  }

  const { start, end, every } = value as {
    start?: number;
    end?: number;
    every?: number;
  };

  if (start !== undefined && end !== undefined && every !== undefined) {
    return `${start}-${end}/${every}`;
  }

  if (start !== undefined && end !== undefined) {
    return `${start}-${end}`;
  }

  if (start !== undefined && every !== undefined) {
    return `${start}/${every}`;
  }

  if (start !== undefined) {
    return `${start}/1`;
  }

  if (end === undefined && every !== undefined) {
    return `*/${every}`;
  }

  throw new TypeError(
    `Invalid cron schedule: start=${start}, end=${end}, every=${every}`,
  );
}

/**
 * Runs the handler, retrying after each backoff delay until it succeeds, the
 * schedule is exhausted or the job is aborted. Like `Deno.cron()`, every
 * failed attempt is logged and never propagates to the scheduler.
 */
async function runWithBackoff(job: CronJobSpec): Promise<void> {
  const backoff = job.backoffSchedule ?? DEFAULT_BACKOFF_SCHEDULE;

  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    if (attempt > 0 && !await sleep(backoff[attempt - 1], job.signal)) {
      return;
    }

    try {
      await job.handler();

      return;
    } catch (error) {
      console.error(`Exception in cron handler ${job.name}`, error);
    }
  }
}

/**
 * Waits `ms` milliseconds, resolving `false` early (or immediately) when the
 * signal aborts and `true` once the delay elapsed.
 */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }

  const { promise, resolve } = Promise.withResolvers<boolean>();
  const onAbort = (): void => {
    clearTimeout(timer);
    resolve(false);
  };
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    resolve(true);
  }, ms);

  signal.addEventListener("abort", onAbort, { once: true });

  return promise;
}
