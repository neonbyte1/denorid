/**
 * Options for the {@linkcode Cron} decorator.
 */
export interface CronOptions {
  /**
   * Explicit name for the cron job: at most 64 bytes of ASCII letters,
   * digits, whitespace, `-` and `_` (the `Deno.cron()` rules, enforced on
   * every runtime). When omitted or empty, the name defaults to
   * `ClassName_methodName` with unsupported characters replaced by `_`.
   */
  name?: string;

  /**
   * Retry delays (milliseconds) applied when the handler throws or rejects:
   * a failed run is retried after each delay in order until it succeeds or
   * the delays are exhausted. At most 5 delays of at most 3,600,000 ms (one
   * hour) each (the `Deno.cron()` limits, enforced on every runtime);
   * registration throws `TypeError("Invalid backoff schedule")` otherwise.
   * Forwarded to `Deno.cron()` when available and emulated otherwise.
   * Defaults to `Deno.cron()`'s `[100, 1000, 5000, 30000, 60000]`; pass `[]`
   * to disable retries.
   */
  backoffSchedule?: number[];
}
