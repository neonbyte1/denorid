/** Identifies a microservice handler. Either a plain string or a structured object. */
export type Pattern = Record<string, unknown> | string;

/** Distinguishes request/response messages from fire-and-forget events. */
export type PatternType = "message" | "event";

/**
 * Normalises a pattern to a stable string key used in handler maps and on the wire.
 *
 * String patterns are returned unchanged. Object patterns are serialised as JSON
 * with the keys of every object, nested ones included, sorted alphabetically, so
 * `{ b: 1, a: { d: 2, c: 3 } }` and `{ a: { c: 3, d: 2 }, b: 1 }` produce the
 * same key. Arrays keep their order.
 *
 * @param {Pattern} pattern - The pattern to serialise.
 * @return {string} The stable string representation.
 */
export function serializePattern(
  pattern: Pattern,
): string {
  return typeof pattern === "string" ? pattern : JSON.stringify(
    pattern,
    (_key: string, value: unknown): unknown =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
          Object.keys(value).sort().map((
            key: string,
          ): [string, unknown] => [
            key,
            (value as Record<string, unknown>)[key],
          ]),
        )
        : value,
  );
}
