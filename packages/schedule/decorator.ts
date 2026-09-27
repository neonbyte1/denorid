import {
  type ClassMethodDecoratorInitializer,
  InvalidStaticMemberDecoratorUsageError,
  type MethodDecorator,
  type Tag,
  TAG_METADATA,
} from "@denorid/injector";
import { CRON_METADATA, CRON_PROVIDER } from "./_constants.ts";
import type { CronMetadata } from "./_metadata.ts";
import type { CronOptions } from "./cron_options.ts";
import type { CronSchedule } from "./cron_schedule.ts";

/**
 * Marks a method as a cron handler.
 *
 * The decorated method is discovered by {@linkcode ScheduleExplorer} on
 * application bootstrap and registered with `Deno.cron()` when the runtime
 * provides it (Deno with `--unstable-cron`, Deno Deploy), or with croner
 * otherwise (Bun, Node.js, Deno without the flag). Schedules are evaluated in
 * UTC and runs never overlap on either backend.
 *
 * When `options.name` is omitted or empty the cron job name defaults to
 * `ClassName_methodName`, with every character other than ASCII letters,
 * digits, `_`, `-` and space replaced by `_` (symbol methods use
 * `String(symbol)`, e.g. `ClassName_Symbol_tick_`). Names follow the
 * `Deno.cron()` rules on every runtime: at most 64 bytes of ASCII letters,
 * digits, whitespace, `-` and `_`; anything else throws a `TypeError` at
 * bootstrap.
 *
 * @param {string | CronSchedule} schedule - Cron expression or structured schedule.
 * @param {CronOptions} [options] - Optional name and backoff schedule.
 * @return {MethodDecorator}
 *
 * @example Named cron job
 * ```ts
 * \@Injectable()
 * class NotificationService {
 *   \@Cron("0 * * * *", { name: "hourly-notifications" })
 *   send() { ... }
 * }
 * ```
 *
 * @example Default name (NotificationService_send)
 * ```ts
 * \@Injectable()
 * class NotificationService {
 *   \@Cron("* * * * *")
 *   send() { ... }
 * }
 * ```
 */
export function Cron(
  schedule: string | CronSchedule,
  options?: CronOptions,
): MethodDecorator {
  return function <
    T extends object,
    V extends ClassMethodDecoratorInitializer<T>,
  >(
    target: V,
    ctx: ClassMethodDecoratorContext<T, V>,
  ): V {
    if (ctx.static) {
      throw new InvalidStaticMemberDecoratorUsageError(
        Cron.name,
        ctx.name,
        "function",
      );
    }

    const existingTags = (ctx.metadata[TAG_METADATA] ?? []) as Tag[];
    ctx.metadata[TAG_METADATA] = [
      ...new Set<Tag>([...existingTags, CRON_PROVIDER]),
    ];

    const cache = (ctx.metadata[CRON_METADATA] ??= []) as CronMetadata[];

    cache.push({
      schedule,
      method: ctx.name,
      name: options?.name || undefined,
      backoffSchedule: options?.backoffSchedule,
    });

    return target;
  };
}
