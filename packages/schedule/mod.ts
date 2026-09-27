/**
 * Denorid schedule module providing decorator-based cron job registration
 * that runs on Deno, Bun and Node.js.
 *
 * Jobs are backed by `Deno.cron()` when the runtime provides it (Deno with
 * `--unstable-cron` or the `"cron"` entry in the `unstable` array of
 * `deno.json`, Deno Deploy) and by
 * [croner](https://jsr.io/@hexagon/croner) otherwise. Both backends use the
 * same cron dialect (5 fields, UTC, numeric weekdays `1`-`7` starting on
 * Sunday), never overlap runs and retry failed runs according to
 * `backoffSchedule`.
 *
 * # Usage
 *
 * Import {@linkcode ScheduleModule} into your application module and annotate
 * methods with {@linkcode Cron}:
 *
 * ```ts
 * import { ScheduleModule, Cron } from "@denorid/schedule";
 * import { Injectable, Module } from "@denorid/injector";
 *
 * \@Injectable()
 * class TaskService {
 *   \@Cron("* * * * *")
 *   everyMinute() { ... }
 *
 *   \@Cron("0 9 * * 1", { name: "weekly-report" })
 *   weeklyReport() { ... }
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
export * from "./module.ts";
export * from "./registry.ts";
