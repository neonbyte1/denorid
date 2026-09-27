import amqplib, { type ChannelModel } from "amqplib";
import type { RmqOptions } from "./options.ts";

/**
 * Connects to the broker configured in `options`, retrying failed attempts.
 *
 * Makes up to `options.maxConnectionAttempts` attempts (default `1`, values
 * below `1` mean a single attempt) and waits `options.retryDelay` milliseconds
 * (default `1000`) between them.
 *
 * @param {RmqOptions} options - Transport options holding url and retry settings.
 * @param {AbortSignal} [signal] - Aborting it stops retrying: the pending delay
 * rejects with `signal.reason` and no further attempt is made.
 * @return {Promise<ChannelModel>} The connected channel model.
 * @throws {unknown} The error of the last attempt, or `signal.reason` once aborted.
 */
export async function connectWithRetry(
  options: RmqOptions,
  signal?: AbortSignal,
): Promise<ChannelModel> {
  const url = options.url ?? "amqp://localhost";
  const maxAttempts = options.maxConnectionAttempts ?? 1;
  const retryDelay = options.retryDelay ?? 1000;

  for (let attempt = 1;; attempt++) {
    try {
      return await amqplib.connect(url as string);
    } catch (err) {
      // `!(a < b)` rather than `a >= b`: a `NaN` limit means one attempt too.
      if (!(attempt < maxAttempts)) {
        throw err;
      }
    }

    await delay(retryDelay, signal);
  }
}

/**
 * Waits `ms` milliseconds.
 *
 * @param {number} ms - How long to wait, in milliseconds.
 * @param {AbortSignal} [signal] - Aborting it clears the timer and rejects
 * with `signal.reason`; an already aborted signal rejects right away.
 * @return {Promise<void>} Resolves once the time elapsed.
 * @throws {unknown} `signal.reason` once aborted.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const onAbort = (): void => {
    clearTimeout(timer);
    reject(signal!.reason);
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);

  signal?.addEventListener("abort", onAbort, { once: true });

  return promise;
}

/**
 * Closes an amqplib channel or connection, ignoring every failure (already
 * closed, socket gone). Accepts `undefined` for "nothing to close".
 *
 * @param {{ close(): Promise<void> }} [target] - The channel or connection.
 * @return {Promise<void>} Resolves once the close attempt settled.
 */
export async function closeQuietly(
  target?: { close(): Promise<void> },
): Promise<void> {
  try {
    await target?.close();
    // deno-lint-ignore no-empty
  } catch {}
}
