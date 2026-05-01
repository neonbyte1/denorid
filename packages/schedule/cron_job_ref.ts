/**
 * A handle representing a registered Deno cron job.
 */
export class CronJobRef {
  /** Registered name of the cron job. */
  public readonly name: string;

  /** Cron schedule (cron string or structured schedule). */
  public readonly schedule: string | Deno.CronSchedule;

  /** The wrapped handler function passed to {@linkcode Deno.cron}. */
  public readonly handler: () => void | Promise<void>;

  /** Controller used to abort (cancel) the running cron job. */
  public readonly controller: AbortController;

  /**
   * Custom backoff schedule for retries, forwarded to {@linkcode Deno.cron}.
   */
  public readonly backoffSchedule?: number[];

  /**
   * @param {object} params - Construction parameters.
   * @param {string} params.name - The cron job name.
   * @param {string | Deno.CronSchedule} params.schedule - The schedule.
   * @param {() => void | Promise<void>} params.handler - The handler.
   * @param {AbortController} params.controller - The abort controller.
   * @param {number[]} [params.backoffSchedule] - Optional backoff schedule.
   */
  public constructor(params: {
    name: string;
    schedule: string | Deno.CronSchedule;
    handler: () => void | Promise<void>;
    controller: AbortController;
    backoffSchedule?: number[];
  }) {
    this.name = params.name;
    this.schedule = params.schedule;
    this.handler = params.handler;
    this.controller = params.controller;
    this.backoffSchedule = params.backoffSchedule;
  }

  /**
   * Aborts the underlying cron job by signalling its {@linkcode AbortController}.
   *
   * @return {void}
   */
  public deleteCronJob(): void {
    this.controller.abort();
  }
}
