import {
  Inject,
  Injectable,
  type ModuleRef,
  type OnApplicationBootstrap,
  type Type,
} from "@denorid/injector";
import { CRON_METADATA, SCHEDULE_PROVIDER } from "./_constants.ts";
import { registerCronJob } from "./_cron_runtime.ts";
import type { CronMetadata } from "./_metadata.ts";
import { CronJobRef } from "./cron_job_ref.ts";
import { SchedulerRegistry } from "./registry.ts";

type CronInstance = Record<
  string | symbol,
  (...args: unknown[]) => void | Promise<void>
>;

/**
 * Internal lifecycle service that discovers `@Cron()`-decorated providers on
 * application bootstrap and registers each method with `Deno.cron()` when the
 * runtime provides it, or with croner otherwise.
 */
@Injectable()
export class ScheduleExplorer implements OnApplicationBootstrap {
  @Inject(SchedulerRegistry)
  private readonly registry!: SchedulerRegistry;

  public constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * @inheritdoc
   */
  public async onApplicationBootstrap(): Promise<void> {
    const registered = new Set<CronJobRef>();

    try {
      await this.discoverCronJobs(registered);
    } catch (error) {
      // Bootstrap fails: stop the jobs registered before the failure.
      for (const [name, ref] of this.registry.getCronJobs()) {
        if (registered.has(ref)) {
          this.registry.deleteCronJob(name);
        }
      }

      throw error;
    }
  }

  /**
   * Registers every `@Cron()` method of the tagged providers.
   *
   * @param {Set<CronJobRef>} registered - Receives every job added to the
   *        registry, so the caller can stop them when a later one fails.
   * @return {Promise<void>}
   */
  private async discoverCronJobs(registered: Set<CronJobRef>): Promise<void> {
    const providers = this.moduleRef.getTokensByTag<Type>(SCHEDULE_PROVIDER, {
      strict: false,
    });

    for (const provider of providers) {
      const cronMetadataList = provider[Symbol.metadata]?.[CRON_METADATA] as
        | CronMetadata[]
        | undefined;

      if (!cronMetadataList?.length) {
        continue;
      }

      const instance = await this.moduleRef.get(provider, {
        strict: false,
      }) as CronInstance;

      for (const meta of cronMetadataList) {
        // Default names must satisfy Deno.cron's charset on every runtime.
        const name = meta.name ||
          `${provider.name}_${String(meta.method)}`.replace(
            /[^A-Za-z0-9_\- ]/g,
            "_",
          );
        const controller = new AbortController();
        const handler = instance[meta.method].bind(instance) as () =>
          | void
          | Promise<void>;

        registerCronJob({
          name,
          schedule: meta.schedule,
          handler,
          signal: controller.signal,
          backoffSchedule: meta.backoffSchedule,
        });

        const ref = new CronJobRef({
          name,
          schedule: meta.schedule,
          handler,
          controller,
          backoffSchedule: meta.backoffSchedule,
        });

        try {
          this.registry.addCronJob(name, ref);
        } catch (error) {
          // Stop the job registered above so it does not run untracked.
          controller.abort();

          throw error;
        }

        registered.add(ref);
      }
    }
  }
}
