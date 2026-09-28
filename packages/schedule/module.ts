import { Module } from "@denorid/injector";
import { ScheduleExplorer } from "./_explorer.ts";
import { SchedulerRegistry } from "./registry.ts";

/**
 * Denorid module that enables decorator-based cron job and interval
 * registration.
 *
 * Import this module to activate `@Cron()` and `@Interval()` discovery at
 * bootstrap and make {@linkcode SchedulerRegistry} available for injection.
 * Cron jobs run on `Deno.cron()` when the runtime provides it and on croner
 * otherwise (Bun, Node.js, Deno without `--unstable-cron`); intervals run on
 * `setInterval` everywhere.
 *
 * > **Deno Deploy note:** Jobs are registered at runtime during
 * > `onApplicationBootstrap`. Deno Deploy's static top-level cron discovery
 * > will not see decorator-registered jobs.
 *
 * @example
 * ```ts
 * \@Module({
 *   imports: [ScheduleModule],
 *   providers: [NotificationService],
 * })
 * class AppModule {}
 *
 * \@Injectable()
 * class NotificationService {
 *   \@Cron("0 * * * *", { name: "hourly-notifications" })
 *   send() { ... }
 * }
 * ```
 */
@Module({
  providers: [SchedulerRegistry, ScheduleExplorer],
  exports: [SchedulerRegistry],
})
export class ScheduleModule {}
