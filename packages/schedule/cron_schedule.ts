/**
 * Value of a single field in a {@linkcode CronSchedule}.
 *
 * - `number`: a single exact value (`5`).
 * - `{ exact }`: one or more exact values (`5` or `1,15,30`).
 * - `{ start, end, every }`: a range and/or step (`1-5`, `1-5/2`, `10/5`,
 *   or every `n` units when only `every` is set).
 *
 * Structurally identical to `Deno.CronScheduleExpression`, so values can be
 * passed to `Deno.cron()` unchanged.
 */
export type CronScheduleExpression =
  | number
  | { exact: number | number[] }
  | {
    start?: number;
    end?: number;
    every?: number;
  };

/**
 * Structured (JSON) cron schedule, evaluated in the UTC time zone.
 *
 * Unspecified fields default to "every value", except that the fields below
 * the most significant specified field are pinned to their first value (for
 * example `{ hour: { every: 2 } }` runs at minute `0` of every second hour).
 *
 * Structurally identical to `Deno.CronSchedule`, so values can be passed to
 * `Deno.cron()` unchanged.
 */
export interface CronSchedule {
  /** Minute of the hour (`0`-`59`). */
  minute?: CronScheduleExpression;

  /** Hour of the day (`0`-`23`). */
  hour?: CronScheduleExpression;

  /** Day of the month (`1`-`31`). */
  dayOfMonth?: CronScheduleExpression;

  /** Month of the year (`1`-`12`). */
  month?: CronScheduleExpression;

  /**
   * Day of the week (`1`-`7`, where `1` is Sunday and `7` is Saturday), as
   * interpreted by `Deno.cron()`.
   */
  dayOfWeek?: CronScheduleExpression;
}
