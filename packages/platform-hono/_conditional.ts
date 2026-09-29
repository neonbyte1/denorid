import type { Context } from "@hono/hono";

/**
 * Evaluates the conditional request headers against the validators of the
 * response. `If-None-Match` takes precedence over `If-Modified-Since`
 * (RFC 9110, section 13.2.2).
 *
 * @param {Context} c - Hono context of the current request.
 * @param {string | null} etag - Entity tag of the response, strong or weak;
 * `null` without one.
 * @param {number} lastModified - Modification time in whole seconds, as ms;
 * `NaN` without one.
 * @return {boolean} `true` when the client copy is current.
 */
export function isNotModified(
  c: Context,
  etag: string | null,
  lastModified: number,
): boolean {
  const ifNoneMatch = c.req.header("If-None-Match");

  if (ifNoneMatch !== undefined) {
    // Weak comparison (RFC 9110, section 8.8.3.2) ignores the `W/` prefix.
    const opaqueTag = etag?.replace(/^W\//, "");

    return ifNoneMatch.split(",").some((candidate) => {
      const tag = candidate.trim();

      return tag === "*" || tag.replace(/^W\//, "") === opaqueTag;
    });
  }

  // An absent or invalid date parses to NaN.
  return Date.parse(c.req.header("If-Modified-Since") ?? "") >= lastModified;
}
