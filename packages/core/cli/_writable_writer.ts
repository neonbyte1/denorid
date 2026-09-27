import type { ConsoleWriter } from "./command_runner.ts";

/**
 * Minimal subset of a Node.js `Writable` (e.g. `process.stdout` from
 * `node:process`) consumed by {@linkcode toConsoleWriter}.
 */
export interface WritableLike {
  /**
   * Queues `chunk` for writing.
   *
   * @param {Uint8Array} chunk - Bytes to write.
   * @param {(error?: Error | null) => void} callback - Invoked once the chunk was flushed (without an error) or failed.
   * @returns {boolean} Back-pressure hint (ignored by the adapter).
   */
  write(chunk: Uint8Array, callback: (error?: Error | null) => void): boolean;
}

/**
 * Adapts a Node.js `Writable` (e.g. `process.stdout` / `process.stderr`,
 * available on Deno, Bun and Node.js) into a {@linkcode ConsoleWriter}.
 *
 * Each `write` resolves with the full byte length of the chunk once the stream
 * invoked its write callback, and rejects with the error the stream reported.
 *
 * @param {WritableLike} stream - Target stream.
 * @returns {ConsoleWriter} Writer forwarding every chunk to `stream`.
 */
export function toConsoleWriter(stream: WritableLike): ConsoleWriter {
  return {
    write(p: Uint8Array): Promise<number> {
      return new Promise<number>((resolve, reject): void => {
        stream.write(p, (error?: Error | null): void => {
          if (error) {
            reject(error);
          } else {
            resolve(p.byteLength);
          }
        });
      });
    },
  };
}
