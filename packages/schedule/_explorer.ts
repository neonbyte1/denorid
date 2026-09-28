import {
  Inject,
  Injectable,
  type ModuleRef,
  type OnApplicationBootstrap,
  type Type,
} from "@denorid/injector";
import {
  CRON_METADATA,
  INTERVAL_METADATA,
  SCHEDULE_PROVIDER,
} from "./_constants.ts";
import { registerCronJob } from "./_cron_runtime.ts";
import { startInterval } from "./_interval_runtime.ts";
import type { CronMetadata, IntervalMetadata } from "./_metadata.ts";
import { CronJobRef } from "./cron_job_ref.ts";
import { type IntervalHandle, SchedulerRegistry } from "./registry.ts";

type ScheduledInstance = Record<
  string | symbol,
  (...args: unknown[]) => void | Promise<void>
>;

/**
 * Everything one bootstrap added to the registry, so it can be stopped when
 * a later registration fails.
 */
interface Registered {
  cronJobs: Set<CronJobRef>;
  intervals: Set<IntervalHandle>;
}

/**
 * Internal lifecycle service that discovers `@Cron()` and `@Interval()`
 * methods on application bootstrap. Cron methods are registered with
 * `Deno.cron()` when the runtime provides it, or with croner otherwise;
 * interval methods are started with `setInterval`.
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
    const registered: Registered = {
      cronJobs: new Set(),
      intervals: new Set(),
    };

    try {
      await this.discover(registered);
    } catch (error) {
      // Bootstrap fails: stop the jobs registered before the failure.
      for (const [name, ref] of this.registry.getCronJobs()) {
        if (registered.cronJobs.has(ref)) {
          this.registry.deleteCronJob(name);
        }
      }

      for (const name of this.registry.getIntervals()) {
        if (registered.intervals.has(this.registry.getInterval(name))) {
          this.registry.deleteInterval(name);
        }
      }

      throw error;
    }
  }

  /**
   * Registers every `@Cron()` and `@Interval()` method of the tagged
   * providers.
   *
   * @param {Registered} registered - Receives every job and interval added
   *        to the registry, so the caller can stop them when a later one
   *        fails.
   * @return {Promise<void>}
   */
  private async discover(registered: Registered): Promise<void> {
    const providers = this.moduleRef.getTokensByTag<Type>(SCHEDULE_PROVIDER, {
      strict: false,
    });

    for (const provider of providers) {
      const metadata = provider[Symbol.metadata];
      const cronMetadataList = (metadata?.[CRON_METADATA] ??
        []) as CronMetadata[];
      const intervalMetadataList = (metadata?.[INTERVAL_METADATA] ??
        []) as IntervalMetadata[];

      if (!cronMetadataList.length && !intervalMetadataList.length) {
        continue;
      }

      const instance = await this.moduleRef.get(provider, {
        strict: false,
      }) as ScheduledInstance;

      for (const meta of cronMetadataList) {
        const name = meta.name || defaultName(provider, meta.method);
        const controller = new AbortController();
        const handler = bindHandler(instance, meta.method);

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

        registered.cronJobs.add(ref);
      }

      for (const meta of intervalMetadataList) {
        const name = meta.name || defaultName(provider, meta.method);
        const handle = startInterval({
          name,
          ms: meta.ms,
          handler: bindHandler(instance, meta.method),
        });

        try {
          this.registry.addInterval(name, handle);
        } catch (error) {
          // Stop the interval started above so it does not run untracked.
          clearInterval(handle);

          throw error;
        }

        registered.intervals.add(handle);
      }
    }
  }
}

/**
 * Builds the name of an unnamed job or interval: `ClassName_methodName` with
 * every character `Deno.cron()` rejects in names replaced by `_`, so default
 * names are valid on every runtime and share one format.
 *
 * @param {Type} provider - The provider class.
 * @param {string | symbol} method - The decorated method.
 * @return {string}
 */
function defaultName(provider: Type, method: string | symbol): string {
  return `${provider.name}_${String(method)}`.replace(
    /[^A-Za-z0-9_\- ]/g,
    "_",
  );
}

/**
 * Binds a decorated method to its provider instance.
 *
 * @param {ScheduledInstance} instance - The provider instance.
 * @param {string | symbol} method - The decorated method.
 * @return {() => void | Promise<void>}
 */
function bindHandler(
  instance: ScheduledInstance,
  method: string | symbol,
): () => void | Promise<void> {
  return instance[method].bind(instance) as () => void | Promise<void>;
}
