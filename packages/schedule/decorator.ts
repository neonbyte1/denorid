import {
  type ClassMethodDecoratorInitializer,
  InvalidStaticMemberDecoratorUsageError,
  type MethodDecorator,
  type Tag,
  TAG_METADATA,
} from "@denorid/injector";
import {
  CRON_METADATA,
  INTERVAL_METADATA,
  SCHEDULE_PROVIDER,
} from "./_constants.ts";
import { MAX_INTERVAL_MS } from "./_interval_runtime.ts";
import type { CronMetadata, IntervalMetadata } from "./_metadata.ts";
import type { CronOptions } from "./cron_options.ts";
import type { CronSchedule } from "./cron_schedule.ts";
import type { IntervalOptions } from "./interval_options.ts";

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
    tagScheduleProvider(Cron.name, ctx);

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

/**
 * Marks a method as an interval handler that runs every `ms` milliseconds.
 *
 * The decorated method is discovered by {@linkcode ScheduleExplorer} on
 * application bootstrap, started with `setInterval` on every runtime and
 * registered as an interval in {@linkcode SchedulerRegistry}. The first run
 * happens one delay after bootstrap. A tick that arrives while the previous
 * run is still pending is skipped, and a run that throws or rejects is
 * logged with `console.error` without stopping the interval (no retries).
 *
 * When `options.name` is omitted or empty the interval name defaults to
 * `ClassName_methodName`, with every character other than ASCII letters,
 * digits, `_`, `-` and space replaced by `_`.
 *
 * @param {number} ms - Delay between runs in milliseconds: an integer from
 *        `1` to `2147483647`.
 * @param {IntervalOptions} [options] - Optional name.
 * @return {MethodDecorator}
 * @throws {RangeError} When `ms` is not an integer from `1` to `2147483647`.
 *
 * @example Heartbeat every 10 seconds (PresenceService_heartbeat)
 * ```ts
 * \@Injectable()
 * class PresenceService {
 *   \@Interval(10_000)
 *   heartbeat() { ... }
 * }
 * ```
 *
 * @example Named interval
 * ```ts
 * \@Injectable()
 * class PresenceService {
 *   \@Interval(30_000, { name: "presence-sweep" })
 *   sweep() { ... }
 * }
 * ```
 */
export function Interval(
  ms: number,
  options?: IntervalOptions,
): MethodDecorator {
  if (!Number.isInteger(ms) || ms < 1 || ms > MAX_INTERVAL_MS) {
    throw new RangeError(
      `Invalid interval delay ${ms}: expected an integer from 1 to ${MAX_INTERVAL_MS} ms.`,
    );
  }

  return function <
    T extends object,
    V extends ClassMethodDecoratorInitializer<T>,
  >(
    target: V,
    ctx: ClassMethodDecoratorContext<T, V>,
  ): V {
    tagScheduleProvider(Interval.name, ctx);

    const cache =
      (ctx.metadata[INTERVAL_METADATA] ??= []) as IntervalMetadata[];

    cache.push({ ms, method: ctx.name, name: options?.name || undefined });

    return target;
  };
}

/**
 * Rejects static members and tags the class so {@linkcode ScheduleExplorer}
 * finds it on bootstrap.
 *
 * @param {string} decorator - Decorator name used in the error message.
 * @param {ClassMethodDecoratorContext} ctx - Context of the decorated method.
 * @return {void}
 * @throws {InvalidStaticMemberDecoratorUsageError} When the method is static.
 */
function tagScheduleProvider<
  T extends object,
  V extends ClassMethodDecoratorInitializer<T>,
>(
  decorator: string,
  ctx: ClassMethodDecoratorContext<T, V>,
): void {
  if (ctx.static) {
    throw new InvalidStaticMemberDecoratorUsageError(
      decorator,
      ctx.name,
      "function",
    );
  }

  const existingTags = (ctx.metadata[TAG_METADATA] ?? []) as Tag[];

  ctx.metadata[TAG_METADATA] = [
    ...new Set<Tag>([...existingTags, SCHEDULE_PROVIDER]),
  ];
}
