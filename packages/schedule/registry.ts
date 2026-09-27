import { Injectable } from "@denorid/injector";
import type { CronJobRef } from "./cron_job_ref.ts";
import {
  SchedulerItemAlreadyExistsException,
  SchedulerItemNotFoundException,
} from "./exceptions.ts";

/**
 * Handle returned by `setInterval`: a number on Deno, a timer object on
 * Node.js and Bun.
 */
export type IntervalHandle = ReturnType<typeof setInterval>;

/**
 * Handle returned by `setTimeout`: a number on Deno, a timer object on
 * Node.js and Bun.
 */
export type TimeoutHandle = ReturnType<typeof setTimeout>;

/**
 * Registry for intervals, timeouts, and cron jobs managed by the schedule
 * module.
 *
 * Inject this to add, retrieve, or cancel scheduled tasks at runtime.
 *
 * @example
 * ```ts
 * constructor(private readonly scheduler: SchedulerRegistry) {}
 *
 * stopJob() {
 *   this.scheduler.deleteCronJob("MyService.runEveryMinute");
 * }
 * ```
 */
@Injectable()
export class SchedulerRegistry {
  private readonly intervals = new Map<string, number>();
  private readonly timeouts = new Map<string, number>();
  private readonly cronJobs = new Map<string, CronJobRef>();

  /**
   * Registers a named interval handle.
   *
   * @param {string} name - Unique name for the interval.
   * @param {number} intervalRef - The return value of `setInterval`.
   * @return {void}
   * @throws {SchedulerItemAlreadyExistsException} When name is already taken.
   */
  public addInterval(name: string, intervalRef: number): void {
    if (this.intervals.has(name)) {
      throw new SchedulerItemAlreadyExistsException("Interval", name);
    }

    this.intervals.set(name, intervalRef);
  }

  /**
   * Clears and removes a named interval.
   *
   * @param {string} name - The interval name.
   * @return {void}
   * @throws {SchedulerItemNotFoundException} When name is not found.
   */
  public deleteInterval(name: string): void {
    const ref = this.getInterval(name);

    clearInterval(ref);
    this.intervals.delete(name);
  }

  /**
   * Returns the interval handle for the given name.
   *
   * @param {string} name - The interval name.
   * @return {IntervalHandle}
   * @throws {SchedulerItemNotFoundException} When name is not found.
   */
  public getInterval(name: string): IntervalHandle {
    const ref = this.intervals.get(name);

    if (ref === undefined) {
      throw new SchedulerItemNotFoundException("Interval", name);
    }

    return ref;
  }

  /**
   * Returns all registered interval names.
   *
   * @return {string[]}
   */
  public getIntervals(): string[] {
    return [...this.intervals.keys()];
  }

  /**
   * Registers a named timeout handle.
   *
   * @param {string} name - Unique name for the timeout.
   * @param {TimeoutHandle} timeoutRef - The return value of `setTimeout`.
   * @return {void}
   * @throws {SchedulerItemAlreadyExistsException} When name is already taken.
   */
  public addTimeout(name: string, timeoutRef: TimeoutHandle): void {
    if (this.timeouts.has(name)) {
      throw new SchedulerItemAlreadyExistsException("Timeout", name);
    }

    this.timeouts.set(name, timeoutRef);
  }

  /**
   * Clears and removes a named timeout.
   *
   * @param {string} name - The timeout name.
   * @return {void}
   * @throws {SchedulerItemNotFoundException} When name is not found.
   */
  public deleteTimeout(name: string): void {
    const ref = this.getTimeout(name);

    clearTimeout(ref);
    this.timeouts.delete(name);
  }

  /**
   * Returns the timeout handle for the given name.
   *
   * @param {string} name - The timeout name.
   * @return {TimeoutHandle}
   * @throws {SchedulerItemNotFoundException} When name is not found.
   */
  public getTimeout(name: string): TimeoutHandle {
    const ref = this.timeouts.get(name);

    if (ref === undefined) {
      throw new SchedulerItemNotFoundException("Timeout", name);
    }

    return ref;
  }

  /**
   * Returns all registered timeout names.
   *
   * @return {string[]}
   */
  public getTimeouts(): string[] {
    return [...this.timeouts.keys()];
  }

  /**
   * Registers a named cron job reference.
   *
   * @param {string} name - Unique name for the cron job.
   * @param {CronJobRef} cronJobRef - The cron job reference.
   * @return {void}
   * @throws {SchedulerItemAlreadyExistsException} When name is already taken.
   */
  public addCronJob(name: string, cronJobRef: CronJobRef): void {
    if (this.cronJobs.has(name)) {
      throw new SchedulerItemAlreadyExistsException("CronJob", name);
    }

    this.cronJobs.set(name, cronJobRef);
  }

  /**
   * Aborts and removes a named cron job.
   *
   * @param {string} name - The cron job name.
   * @return {void}
   * @throws {SchedulerItemNotFoundException} When name is not found.
   */
  public deleteCronJob(name: string): void {
    const ref = this.getCronJob(name);

    ref.deleteCronJob();
    this.cronJobs.delete(name);
  }

  /**
   * Returns the cron job reference for the given name.
   *
   * @param {string} name - The cron job name.
   * @return {CronJobRef}
   * @throws {SchedulerItemNotFoundException} When name is not found.
   */
  public getCronJob(name: string): CronJobRef {
    const ref = this.cronJobs.get(name);

    if (!ref) {
      throw new SchedulerItemNotFoundException("CronJob", name);
    }

    return ref;
  }

  /**
   * Returns the full map of registered cron jobs.
   *
   * @return {Map<string, CronJobRef>}
   */
  public getCronJobs(): Map<string, CronJobRef> {
    return this.cronJobs;
  }
}
