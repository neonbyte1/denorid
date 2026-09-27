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

/** A single byte range: `bytes=first-last`, `bytes=first-` or `bytes=-n`. */
const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/i;

/** A regular file found below the static files root. */
interface StaticFile {
  path: string;
  stats: Stats;
}

/** Inclusive byte positions of a partial response. */
interface ByteRange {
  start: number;
  end: number;
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
 * @param {string} etag - Strong entity tag of the file.
 * @param {number} lastModified - Modification time in whole seconds, as ms.
 * @return {boolean} `true` when the client copy is current.
 */
function isNotModified(
  c: Context,
  etag: string,
  lastModified: number,
): boolean {
  const ifNoneMatch = c.req.header("If-None-Match");

  if (ifNoneMatch !== undefined) {
    // Weak comparison (RFC 9110, section 8.8.3.2) ignores the `W/` prefix.
    return ifNoneMatch.split(",").some((candidate) => {
      const tag = candidate.trim();

      return tag === "*" || tag.replace(/^W\//, "") === etag;
    });
  }

  // An absent or invalid date parses to NaN.
  return Date.parse(c.req.header("If-Modified-Since") ?? "") >= lastModified;
}

/**
 * Evaluates `If-Range` (RFC 9110, section 13.1.5): a range is only sent while
 * the validator still matches, strongly for entity tags and exactly for dates.
 *
 * @param {Context} c - Hono context of the current request.
 * @param {string} etag - Strong entity tag of the file.
 * @param {number} lastModified - Modification time in whole seconds, as ms.
 * @return {boolean} `true` when a requested range may be sent.
 */
function isRangeCurrent(
  c: Context,
  etag: string,
  lastModified: number,
): boolean {
  const ifRange = c.req.header("If-Range")?.trim();

  if (ifRange === undefined) {
    return true;
  }

  return ifRange.startsWith('"')
    ? ifRange === etag
    : Date.parse(ifRange) === lastModified;
}

/**
 * Parses a `Range` header against the file size (RFC 9110, section 14.1.1).
 * Only a single byte range is supported; anything else is ignored and the
 * full file is sent, as is for empty files.
 *
 * @param {string | undefined} header - The `Range` header.
 * @param {number} size - File size in bytes.
 * @return {ByteRange | null | undefined} The range to send, `null` when it is
 * unsatisfiable, or `undefined` to send the full file.
 */
function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | null | undefined {
  const match = BYTE_RANGE.exec(header?.trim() ?? "");

  if (match === null || size === 0) {
    return undefined;
  }

  const [, first, last] = match;

  if (first === "") {
    // `bytes=-n` asks for the last n bytes, `bytes=-` is invalid.
    if (last === "") {
      return undefined;
    }

    const length = Number(last);

    return length === 0
      ? null
      : { start: Math.max(size - length, 0), end: size - 1 };
  }

  const start = Number(first);

  if (last !== "" && Number(last) < start) {
    return undefined;
  }

  if (start >= size) {
    return null;
  }

  return {
    start,
    end: last === "" ? size - 1 : Math.min(Number(last), size - 1),
  };
}

/**
 * Opens a file, or a range of it, as response body.
 *
 * Bun sends streamed bodies chunked and drops `Content-Length`, but keeps it
 * for its lazily read file blobs. It also answers range requests on its own
 * when a whole file blob is sent, ignoring `If-Range`, so whole files are
 * streamed when the request carries a `Range` header.
 *
 * @param {string} path - The file to open.
 * @param {ByteRange | undefined} range - The part to send, all when omitted.
 * @param {boolean} rangeRequested - Whether the request has a `Range` header.
 * @param {BunRuntime | undefined} bun - The `Bun` global, when running on Bun.
 * @return {BodyInit} The response body.
 */
function openFile(
  path: string,
  range: ByteRange | undefined,
  rangeRequested: boolean,
  bun: BunRuntime | undefined,
): BodyInit {
  if (typeof bun?.file === "function" && (range || !rangeRequested)) {
    const blob = bun.file(path);

    return range ? blob.slice(range.start, range.end + 1) : blob;
  }

  return Readable.toWeb(createReadStream(path, range)) as ReadableStream;
}

/**
 * Answers the request with a file or a range of it, `304 Not Modified` when
 * the client copy is current, or `416 Range Not Satisfiable`.
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
  // Strong, like nginx: rewriting a file changes its size or mtime, and only
  // strong entity tags may be used with `If-Range`.
  const etag = `"${stats.size.toString(16)}-${
    Math.trunc(stats.mtimeMs).toString(16)
  }"`;
  // HTTP dates have second precision.
  const lastModified = Math.floor(stats.mtimeMs / 1000) * 1000;

  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", etag);
  headers.set("Last-Modified", new Date(lastModified).toUTCString());

  if (isNotModified(c, etag, lastModified)) {
    return new Response(null, { status: 304, headers });
  }

  const rangeHeader = c.req.header("Range");
  // Range requests are only defined for GET (RFC 9110, section 14.2).
  const range = c.req.method === "GET" && isRangeCurrent(c, etag, lastModified)
    ? parseRange(rangeHeader, stats.size)
    : undefined;

  if (range === null) {
    headers.set("Content-Range", `bytes */${stats.size}`);
    headers.set("Content-Length", "0");

    return new Response(null, { status: 416, headers });
  }

  headers.set("Content-Type", getMimeType(path) ?? "application/octet-stream");

  if (range === undefined) {
    headers.set("Content-Length", String(stats.size));
  } else {
    headers.set("Content-Length", String(range.end - range.start + 1));
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${stats.size}`,
    );
  }

  // Hono answers HEAD by dropping the body of the GET response, so never open
  // a file that would stay unread.
  if (c.req.method === "HEAD") {
    return new Response(null, { headers });
  }

  return new Response(
    openFile(path, range, rangeHeader !== undefined, bun),
    { status: range === undefined ? 200 : 206, headers },
  );
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
