import { stub } from "@std/testing/mock";
import type { Writable } from "node:stream";

/** Undoes a mock installed by {@link mockStdWrite}. */
export type RestoreFn = () => void;

/**
 * Silences a writable stream such as `process.stdout` or `process.stderr`
 * (from `node:process`) by replacing its `write` method with a no-op that
 * reports success.
 *
 * @param {Pick<Writable, "write">} stream - The stream to silence.
 * @return {RestoreFn} Restores the original `write` method.
 */
export function mockStdWrite(stream: Pick<Writable, "write">): RestoreFn {
  const write = stub(stream, "write", () => true);

  return () => write.restore();
}
