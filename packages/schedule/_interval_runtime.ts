import type { IntervalHandle } from "./registry.ts";

/**
 * Longest delay (milliseconds) timers accept on every runtime: `2^31 - 1`,
 * about 24.8 days. Larger delays overflow and fire after 1 ms.
 */
export const MAX_INTERVAL_MS = 2_147_483_647;

/**
 * An interval to start with `setInterval`.
 */
export interface IntervalJobSpec {
  /** Name used when logging failed runs. */
  name: string;

  /** Delay between runs in milliseconds. */
  ms: number;

  /** Function invoked on every run. */
  handler: () => void | Promise<void>;
}

/**
 * Starts an interval that runs the handler every `ms` milliseconds, first
 * after one delay. Like cron jobs, a tick that arrives while the previous
 * run is still pending is skipped, and a failed run is logged without
 * stopping the interval.
 *
 * @param {IntervalJobSpec} job - The interval to start.
 * @return {IntervalHandle} The handle to pass to `clearInterval`.
 */
export function startInterval(job: IntervalJobSpec): IntervalHandle {
  let busy = false;

  return setInterval(async () => {
    if (busy) {
      return;
    }

    busy = true;

    try {
      await job.handler();
    } catch (error) {
      console.error(`Exception in interval handler ${job.name}`, error);
    } finally {
      busy = false;
    }
  }, job.ms);
}
