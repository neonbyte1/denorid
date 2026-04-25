/** Identifies a microservice handler. Either a plain string or a structured object. */
export type Pattern = Record<string, unknown> | string;

/** Distinguishes request/response messages from fire-and-forget events. */
export type PatternType = "message" | "event";

/**
 * Normalises a pattern to a stable string key used in handler maps and on the wire.
 *
 * String patterns are returned unchanged. Object patterns are serialised as JSON
 * with keys sorted alphabetically so `{ b: 1, a: 2 }` and `{ a: 2, b: 1 }` produce
 * the same key.
 *
 * @param {Pattern} pattern - The pattern to serialise.
 * @return {string} The stable string representation.
 */
export function serializePattern(
  pattern: Pattern,
): string {
  return typeof pattern === "string" ? pattern : JSON.stringify(
    Object.keys(pattern)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = pattern[k];
        return acc;
      }, {}),
  );
}
