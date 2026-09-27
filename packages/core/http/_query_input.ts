import type { z } from "zod";

/** Any Zod schema, typed by the core definitions to read `_zod.def`. */
type Schema = z.core.$ZodType;

/**
 * Nesting limit of the schema walk. It stops schemas whose `z.lazy()` getter
 * builds a new schema on every call, which the seen-set cannot recognize.
 */
const MAX_DEPTH = 64;

/**
 * Walks a schema through wrappers (`optional`, `nullable`, `default`,
 * `prefault`, `catch`, `readonly`, `nonoptional`, the input side of `pipe`
 * and the target of `lazy`), unions and intersections and returns whether
 * `test` holds for any other schema reached this way. Every schema is visited
 * once, which ends recursive `z.lazy()` schemas.
 *
 * @param {Schema} schema - The schema to start at.
 * @param {(schema: Schema) => boolean} test - Checked for every reached schema
 *   that is no wrapper, union or intersection.
 * @param {Set<Schema>} [seen] - The schemas visited so far.
 * @param {number} [depth] - Nesting of `schema` below the start.
 * @return {boolean} `true` when `test` holds for any reached schema.
 */
function someVariant(
  schema: Schema,
  test: (schema: Schema) => boolean,
  seen: Set<Schema> = new Set(),
  depth: number = 0,
): boolean {
  if (seen.has(schema) || depth > MAX_DEPTH) {
    return false;
  }

  seen.add(schema);

  const def = (schema as z.core.$ZodTypes)._zod.def;
  const visit = (inner: Schema): boolean =>
    someVariant(inner, test, seen, depth + 1);

  switch (def.type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
      return visit(def.innerType);
    case "pipe":
      return visit(def.in);
    case "lazy":
      return visit(def.getter());
    case "union":
      return def.options.some(visit);
    case "intersection":
      return visit(def.left) || visit(def.right);
    default:
      return test(schema);
  }
}

/**
 * Returns whether a schema accepts an array: `array`, `tuple` and `set`,
 * also inside wrappers, unions and intersections.
 *
 * @param {Schema} schema - The schema of a query key.
 * @return {boolean} `true` when the schema accepts an array.
 */
function acceptsArray(schema: Schema): boolean {
  return someVariant(schema, (variant) => {
    const { type } = (variant as z.core.$ZodTypes)._zod.def;

    return type === "array" || type === "tuple" || type === "set";
  });
}

/**
 * Returns whether the field of a query schema for a key accepts an array.
 * The field of an object is its shape entry, else its catchall schema; the
 * field of a record is its value schema. Wrappers, unions and intersections
 * are looked through.
 *
 * @param {Schema} schema - The query schema.
 * @param {string} key - The query key.
 * @return {boolean} `true` when the field of the key accepts an array.
 */
function fieldAcceptsArray(schema: Schema, key: string): boolean {
  return someVariant(schema, (variant) => {
    const def = (variant as z.core.$ZodTypes)._zod.def;

    switch (def.type) {
      case "object": {
        // Query keys come from the client: never read inherited properties.
        const field = Object.hasOwn(def.shape, key)
          ? def.shape[key]
          : def.catchall;

        return field !== undefined && acceptsArray(field);
      }
      case "record":
        return acceptsArray(def.valueType);
      default:
        return false;
    }
  });
}

/**
 * Builds the input of a `@Query()` schema from the query string values.
 *
 * A key whose field accepts an array (see {@link fieldAcceptsArray}) gets all
 * of its values. Any other key gets its value as a string when it is given
 * once, else all values: a repeated key of a scalar field fails validation
 * instead of silently using one of the values.
 *
 * @param {Schema} schema - The query schema.
 * @param {Record<string, string[]>} queries - The values of every query key.
 * @return {Record<string, string | string[]>} The input to validate.
 */
export function createQueryInput(
  schema: Schema,
  queries: Record<string, string[]>,
): Record<string, string | string[]> {
  // `fromEntries` defines own properties, so `__proto__` stays a plain key.
  return Object.fromEntries(
    Object.entries(queries).map((
      [key, values],
    ): [string, string | string[]] => [
      key,
      values.length === 1 && !fieldAcceptsArray(schema, key)
        ? values[0]
        : values,
    ]),
  );
}
