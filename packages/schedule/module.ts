import { Module } from "@denorid/injector";
import { ScheduleExplorer } from "./_explorer.ts";
import { SchedulerRegistry } from "./registry.ts";

/**
 * Denorid module that enables decorator-based Deno cron job registration.
 *
 * Import this module to activate `@Cron()` discovery at bootstrap and make
 * {@linkcode SchedulerRegistry} available for injection.
 *
 * > **Deno Deploy note:** `Deno.cron()` jobs are registered at runtime during
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
