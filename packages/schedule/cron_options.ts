/**
 * Options for the {@linkcode Cron} decorator.
 */
export interface CronOptions {
  /**
   * Explicit name for the cron job.
   * When omitted or empty, the name defaults to `ClassName.methodName`.
   */
  name?: string;

  /**
   * Custom backoff schedule (milliseconds) for retries on handler failure.
   * Forwarded directly to {@linkcode Deno.cron}.
   */
  backoffSchedule?: number[];
}
