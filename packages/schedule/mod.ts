/**
 * Denorid schedule module providing decorator-based cron job registration
 * backed by `Deno.cron()`.
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
 * > will not see decorator-registered jobs. Run `deno` with `--unstable-cron`
 * > or add `"cron"` to the `unstable` array in `deno.json`.
 *
 * @module
 */
export * from "./cron_job_ref.ts";
export * from "./cron_options.ts";
export * from "./decorator.ts";
export * from "./exceptions.ts";
export * from "./module.ts";
export * from "./registry.ts";
