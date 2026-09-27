// deno-coverage-ignore-file
import { type Stub, stub } from "@std/testing/mock";
import fs from "node:fs/promises";
import process from "node:process";

/**
 * Content of a virtual file, or the error reading it rejects with.
 */
export type VirtualFile = string | Error;

/**
 * Replaces `fs.readFile` with a lookup in `files`, keyed by path (strings) or
 * `href` (URLs). Unknown paths reject with an `ENOENT` error like Node.js.
 *
 * @param {Record<string, VirtualFile>} files - Virtual file system.
 * @return {Stub} The installed stub; restore it (or use `using`) afterwards.
 */
export function stubFiles(files: Record<string, VirtualFile>): Stub {
  const readFile = (path: string | URL): Promise<string> => {
    const key = path instanceof URL ? path.href : path;
    const file = Object.hasOwn(files, key) ? files[key] : undefined;

    if (file === undefined) {
      return Promise.reject(
        Object.assign(new Error(`ENOENT: no such file, open '${key}'`), {
          code: "ENOENT",
        }),
      );
    }

    return file instanceof Error ? Promise.reject(file) : Promise.resolve(file);
  };

  return stub(fs, "readFile", readFile as unknown as typeof fs.readFile);
}

/**
 * Sets environment variables for the duration of a test.
 *
 * @param {Record<string, string>} vars - Variables to set.
 * @return {Disposable} Restores the previous values when disposed.
 */
export function setEnv(vars: Record<string, string>): Disposable {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  return {
    [Symbol.dispose](): void {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}
