import type { CronSchedule } from "./cron_schedule.ts";

/**
 * A handle representing a registered cron job, backed by `Deno.cron()` when
 * the runtime provides it and by croner otherwise.
 */
export class CronJobRef {
  /** Registered name of the cron job. */
  public readonly name: string;

  /** Cron schedule (cron string or structured schedule), evaluated in UTC. */
  public readonly schedule: string | CronSchedule;

  /** The handler invoked on every scheduled run. */
  public readonly handler: () => void | Promise<void>;

  /** Controller used to abort (cancel) the running cron job. */
  public readonly controller: AbortController;

  /**
   * Custom retry delays (milliseconds) applied after a failed run.
   */
  public readonly backoffSchedule?: number[];

  /**
   * @param {object} params - Construction parameters.
   * @param {string} params.name - The cron job name.
   * @param {string | CronSchedule} params.schedule - The schedule.
   * @param {() => void | Promise<void>} params.handler - The handler.
   * @param {AbortController} params.controller - The abort controller.
   * @param {number[]} [params.backoffSchedule] - Optional backoff schedule.
   */
  public constructor(params: {
    name: string;
    schedule: string | CronSchedule;
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
   * Stops the underlying cron job by signalling its {@linkcode AbortController}.
   *
   * @return {void}
   */
  public deleteCronJob(): void {
    this.controller.abort();
  }
}
