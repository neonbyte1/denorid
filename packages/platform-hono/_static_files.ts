import type { Context, MiddlewareHandler } from "@hono/hono";
import { getMimeType } from "@hono/hono/utils/mime";
import { createReadStream, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { BunRuntime, RuntimeGlobals } from "./_serve.ts";
import type { StaticFilesOptions } from "./adapter.ts";

/** `Cache-Control` of files below the immutable directory. */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** `Cache-Control` of every other file: may be stored, but is revalidated. */
const REVALIDATE_CACHE = "no-cache";

/** File answered for directory requests. */
const INDEX_FILE = "index.html";

/** Characters a decoded path segment must not contain. */
const FORBIDDEN_CHARS = /[/\\\0]/;

/** A regular file found below the static files root. */
interface StaticFile {
  path: string;
  stats: Stats;
}

/**
 * Stats a path without throwing.
 *
 * @param {string} path - The path to stat.
 * @return {Promise<Stats | undefined>} The stats, or `undefined` when the path
 * cannot be accessed.
 */
async function statOrUndefined(path: string): Promise<Stats | undefined> {
  return await stat(path).catch(() => undefined);
}

/**
 * Maps a URL pathname to the path below `root` it names. A trailing slash
 * names the directory index.
 *
 * Every segment is percent-decoded on its own and rejected when it is empty,
 * contains a path separator or NUL, or starts with a dot. That keeps `.`,
 * `..` and hidden files out and the result below `root`. The only dot segment
 * allowed is a leading `.well-known` (RFC 8615).
 *
 * @param {string} root - Absolute directory the files are served from.
 * @param {string} pathname - Percent-encoded URL pathname.
 * @return {string | undefined} The file path, or `undefined` when the pathname
 * is rejected.
 */
function toFilePath(root: string, pathname: string): string | undefined {
  const parts = pathname.split("/").slice(1);
  const segments: string[] = [];

  if (parts[parts.length - 1] === "") {
    parts[parts.length - 1] = INDEX_FILE;
  }

  for (const [index, part] of parts.entries()) {
    let segment: string;

    try {
      segment = decodeURIComponent(part);
    } catch {
      return undefined;
    }

    if (
      segment === "" ||
      FORBIDDEN_CHARS.test(segment) ||
      (segment.startsWith(".") && (index !== 0 || segment !== ".well-known"))
    ) {
      return undefined;
    }

    segments.push(segment);
  }

  return join(root, ...segments);
}

/**
 * Resolves a path to a regular file, using the index file for directories.
 *
 * @param {string} path - The path to resolve.
 * @return {Promise<StaticFile | undefined>} The file, or `undefined` when the
 * path names no regular file.
 */
async function findFile(path: string): Promise<StaticFile | undefined> {
  let stats = await statOrUndefined(path);

  if (stats?.isDirectory()) {
    path = join(path, INDEX_FILE);
    stats = await statOrUndefined(path);
  }

  return stats?.isFile() ? { path, stats } : undefined;
}

/**
 * Evaluates the conditional request headers against the file validators.
 * `If-None-Match` takes precedence over `If-Modified-Since` (RFC 9110,
 * section 13.2.2).
 *
 * @param {Context} c - Hono context of the current request.
 * @param {string} etag - Weak entity tag of the file.
 * @param {Date} mtime - Modification time of the file.
 * @return {boolean} `true` when the client copy is current.
 */
function isNotModified(c: Context, etag: string, mtime: Date): boolean {
  const ifNoneMatch = c.req.header("If-None-Match");

  if (ifNoneMatch !== undefined) {
    // Weak comparison (RFC 9110, section 8.8.3.2) ignores the `W/` prefix.
    const opaqueTag = etag.slice(2);

    return ifNoneMatch.split(",").some((candidate) => {
      const tag = candidate.trim();

      return tag === "*" || tag.replace(/^W\//, "") === opaqueTag;
    });
  }

  // HTTP dates have second precision; an absent or invalid date parses to NaN.
  return Date.parse(c.req.header("If-Modified-Since") ?? "") >=
    Math.floor(mtime.getTime() / 1000) * 1000;
}

/**
 * Opens a file as response body. Bun sends streamed bodies chunked and drops
 * `Content-Length`, but keeps it for its lazily read file blobs.
 *
 * @param {string} path - The file to open.
 * @param {BunRuntime | undefined} bun - The `Bun` global, when running on Bun.
 * @return {BodyInit} The response body.
 */
function openFile(path: string, bun: BunRuntime | undefined): BodyInit {
  return typeof bun?.file === "function"
    ? bun.file(path)
    : Readable.toWeb(createReadStream(path)) as ReadableStream;
}

/**
 * Answers the request with a file, or `304 Not Modified` when the client copy
 * is current.
 *
 * @param {Context} c - Hono context of the current request.
 * @param {StaticFile} file - The file to send.
 * @param {Headers} headers - Response headers, e.g. `Cache-Control`.
 * @param {BunRuntime | undefined} bun - The `Bun` global, when running on Bun.
 * @return {Response} The response.
 */
function sendFile(
  c: Context,
  file: StaticFile,
  headers: Headers,
  bun: BunRuntime | undefined,
): Response {
  const { path, stats } = file;
  const etag = `W/"${stats.size.toString(16)}-${
    Math.trunc(stats.mtimeMs).toString(16)
  }"`;

  headers.set("ETag", etag);
  headers.set("Last-Modified", stats.mtime.toUTCString());

  if (isNotModified(c, etag, stats.mtime)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Type", getMimeType(path) ?? "application/octet-stream");
  headers.set("Content-Length", String(stats.size));

  // Hono answers HEAD by dropping the body of the GET response, so never open
  // a file that would stay unread.
  if (c.req.method === "HEAD") {
    return new Response(null, { headers });
  }

  return new Response(openFile(path, bun), { headers });
}

/**
 * Creates the handler serving files below `options.root` for `GET` and `HEAD`
 * requests. Requests it does not answer are passed on with `next()`.
 *
 * @param {StaticFilesOptions} options - The static files configuration.
 * @param {string} basePath - Normalized application base path; requests below
 * it are never answered.
 * @param {RuntimeGlobals} [runtime] - Globals used to detect Bun, defaults to
 * `globalThis`.
 * @return {Promise<MiddlewareHandler>} The handler.
 * @throws {Error} When `root` is no directory or `fallback` is no file below
 * `root`.
 */
export async function createStaticFilesHandler(
  options: StaticFilesOptions,
  basePath: string,
  runtime: RuntimeGlobals = globalThis as RuntimeGlobals,
): Promise<MiddlewareHandler> {
  const bun = runtime.Bun;
  const root = resolve(options.root);

  if (!(await statOrUndefined(root))?.isDirectory()) {
    throw new Error(`Static files root ${root} is not a directory`);
  }

  const immutable = options.immutable === undefined
    ? undefined
    : join(root, options.immutable, sep);
  const fallback = options.fallback === undefined
    ? undefined
    : join(root, options.fallback);

  if (
    fallback !== undefined &&
    (!fallback.startsWith(join(root, sep)) ||
      !(await statOrUndefined(fallback))?.isFile())
  ) {
    throw new Error(
      `Static files fallback ${fallback} is not a file in ${root}`,
    );
  }

  return async (c, next) => {
    const path = c.req.path;

    if (
      basePath !== "/" &&
      (path === basePath || path.startsWith(`${basePath}/`))
    ) {
      return await next();
    }

    const filePath = toFilePath(root, new URL(c.req.url).pathname);
    const file = filePath === undefined ? undefined : await findFile(filePath);

    if (file !== undefined) {
      const cacheControl = immutable !== undefined &&
          file.path.startsWith(immutable)
        ? IMMUTABLE_CACHE
        : REVALIDATE_CACHE;

      return sendFile(
        c,
        file,
        new Headers({ "Cache-Control": cacheControl }),
        bun,
      );
    }

    if (
      fallback !== undefined && c.req.header("Accept")?.includes("text/html")
    ) {
      const stats = await statOrUndefined(fallback);

      if (stats?.isFile()) {
        return sendFile(
          c,
          { path: fallback, stats },
          new Headers({ "Cache-Control": REVALIDATE_CACHE, Vary: "Accept" }),
          bun,
        );
      }
    }

    return await next();
  };
}
