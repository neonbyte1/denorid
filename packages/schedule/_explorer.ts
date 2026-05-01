import {
  Inject,
  Injectable,
  type ModuleRef,
  type OnApplicationBootstrap,
  type Type,
} from "@denorid/injector";
import { CRON_METADATA, CRON_PROVIDER } from "./_constants.ts";
import type { CronMetadata } from "./_metadata.ts";
import { CronJobRef } from "./cron_job_ref.ts";
import { SchedulerRegistry } from "./registry.ts";

type CronInstance = Record<
  string | symbol,
  (...args: unknown[]) => void | Promise<void>
>;

/**
 * Internal lifecycle service that discovers `@Cron()`-decorated providers on
 * application bootstrap and registers each method with `Deno.cron()`.
 */
@Injectable()
export class ScheduleExplorer implements OnApplicationBootstrap {
  @Inject(SchedulerRegistry)
  private readonly registry!: SchedulerRegistry;

  public constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * @inheritdoc
   */
  public onApplicationBootstrap(): Promise<void> {
    return this.discoverCronJobs();
  }

  private async discoverCronJobs(): Promise<void> {
    const providers = this.moduleRef.getTokensByTag<Type>(CRON_PROVIDER, {
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
        const name = meta.name || `${provider.name}.${String(meta.method)}`;
        const controller = new AbortController();
        const handler = instance[meta.method].bind(instance) as () =>
          | void
          | Promise<void>;

        Deno.cron(
          name,
          meta.schedule,
          { signal: controller.signal, backoffSchedule: meta.backoffSchedule },
          handler,
        );

        this.registry.addCronJob(
          name,
          new CronJobRef({
            name,
            schedule: meta.schedule,
            handler,
            controller,
            backoffSchedule: meta.backoffSchedule,
          }),
        );
      }
    }
  }
}
