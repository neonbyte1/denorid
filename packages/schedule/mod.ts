/**
 * Denorid schedule module providing decorator-based cron job and interval
 * registration that runs on Deno, Bun and Node.js.
 *
 * Cron jobs are backed by `Deno.cron()` when the runtime provides it (Deno
 * with `--unstable-cron` or the `"cron"` entry in the `unstable` array of
 * `deno.json`, Deno Deploy) and by
 * [croner](https://jsr.io/@hexagon/croner) otherwise. Both backends use the
 * same cron dialect (5 fields, UTC, numeric weekdays `1`-`7` starting on
 * Sunday), never overlap runs and retry failed runs according to
 * `backoffSchedule`. For schedules finer than one minute, {@linkcode Interval}
 * runs a method every given number of milliseconds with `setInterval`, also
 * without overlapping runs. Closing the application stops every cron job,
 * interval and timeout held by {@linkcode SchedulerRegistry}.
 *
 * # Usage
 *
 * Import {@linkcode ScheduleModule} into your application module and annotate
 * methods with {@linkcode Cron} or {@linkcode Interval}:
 *
 * ```ts
 * import { Cron, Interval, ScheduleModule } from "@denorid/schedule";
 * import { Injectable, Module } from "@denorid/injector";
 *
 * \@Injectable()
 * class TaskService {
 *   \@Cron("* * * * *")
 *   everyMinute() { ... }
 *
 *   \@Cron("0 9 * * 1", { name: "weekly-report" })
 *   weeklyReport() { ... }
 *
 *   \@Interval(10_000)
 *   everyTenSeconds() { ... }
 * }
 *
 * \@Module({
 *   imports: [ScheduleModule],
 *   providers: [TaskService],
 * })
 * class AppModule {}
 * ```
 *
 * > **Deno Deploy note:** Jobs are registered at runtime via
 * > `onApplicationBootstrap`. Deno Deploy's static top-level cron discovery
 * > will not see decorator-registered jobs.
 *
 * @module
 */
export * from "./cron_job_ref.ts";
export * from "./cron_options.ts";
export * from "./cron_schedule.ts";
export * from "./decorator.ts";
export * from "./exceptions.ts";
export * from "./interval_options.ts";
export * from "./module.ts";
export * from "./registry.ts";
