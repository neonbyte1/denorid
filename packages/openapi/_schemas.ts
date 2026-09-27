import { z, type ZodType } from "zod";
import type { SchemaObject } from "./types.ts";

/**
 * Direction of a schema: `input` for request data (what the schema accepts),
 * `output` for responses (what parsing returns).
 */
export type SchemaIo = "input" | "output";

/** A zod schema converted to JSON Schema. */
export interface ConvertedSchema {
  /**
   * Schema to put in the document; a reference to `components.schemas` when
   * the zod schema has an `id` (set with `.meta({ id })`).
   */
  schema: SchemaObject;
  /** The schema with a top-level reference resolved, e.g. to read its properties. */
  resolved: SchemaObject;
}

/** Converted definition of a zod schema with an `id`, for one direction. */
interface NamedVariant {
  /** The definition. */
  schema: SchemaObject;
  /** The definition as JSON, to compare it with other conversions. */
  json: string;
  /** Ids of the named definitions it references. */
  references: Set<string>;
}

/** What a `$ref` of a converted schema points to. */
type ReferenceTarget =
  | { kind: "named"; id: string; io: SchemaIo }
  | { kind: "anonymous"; key: number };

/** Prefix of the references created by `z.toJSONSchema()`. */
const DEFS = "#/$defs/";

/** Prefix of the references in the document. */
const COMPONENTS = "#/components/schemas/";

/** Prefix of the definitions `z.toJSONSchema()` creates without `id`. */
const ANONYMOUS = "__schema";

/** A reference to an anonymous definition, numbered per conversion. */
const ANONYMOUS_REFERENCE = /"#\/\$defs\/__schema\d+"/g;

/**
 * Collects the JSON Schemas of zod schemas for an OpenAPI document.
 *
 * Every zod schema with an `id` becomes one entry of `components.schemas`;
 * its uses are references. A schema used for request and response data whose
 * two directions differ (e.g. a `.default()` field is optional in the input,
 * required in the output) gets two entries: `<id>` for the input and
 * `<id>Output` for the output. Recursive schemas without `id` become
 * `Schema1`, `Schema2`, ...
 *
 * References are rewritten by {@link finalize} once the whole document is
 * built, since names depend on every use.
 */
export class SchemaCollector {
  readonly #named = new Map<string, Partial<Record<SchemaIo, NamedVariant>>>();
  readonly #anonymous = new Map<number, SchemaObject>();
  readonly #targets = new WeakMap<object, ReferenceTarget>();
  #anonymousCount = 0;

  /**
   * Converts a zod schema. `z.date()` is documented as a `date-time` string,
   * the way JSON transports it; types JSON cannot represent (e.g. `bigint`)
   * accept any value.
   *
   * @param {ZodType} schema - The zod schema.
   * @param {SchemaIo} io - Direction the schema describes.
   * @return {ConvertedSchema} The JSON Schema.
   * @throws {Error} When two different zod schemas use the same `id`.
   */
  public convert(schema: ZodType, io: SchemaIo): ConvertedSchema {
    const { $schema: _, $defs = {}, ...root } = z.toJSONSchema(schema, {
      target: "draft-2020-12",
      io,
      unrepresentable: "any",
      override: ({ zodSchema, jsonSchema }): void => {
        if (zodSchema._zod.def.type === "date") {
          jsonSchema.type = "string";
          jsonSchema.format = "date-time";
        }
      },
    }) as SchemaObject;
    const anonymous = new Map<string, number>();
    // References to the root, created for a recursive schema without `id`.
    const rootReferences: object[] = [];

    for (const [name, definition] of Object.entries($defs)) {
      if (name.startsWith(ANONYMOUS)) {
        const key = ++this.#anonymousCount;

        anonymous.set(name, key);
        this.#anonymous.set(key, definition as SchemaObject);
      }
    }

    const link = (value: unknown, references?: Set<string>): void => {
      if (typeof value !== "object" || value === null) {
        return;
      }

      const ref = (value as SchemaObject).$ref;

      if (ref === "#") {
        rootReferences.push(value);
      } else if (typeof ref === "string" && ref.startsWith(DEFS)) {
        const name = ref.slice(DEFS.length);
        const key = anonymous.get(name);

        this.#targets.set(
          value,
          key === undefined
            ? { kind: "named", id: name, io }
            : { kind: "anonymous", key },
        );

        if (key === undefined) {
          references?.add(name);
        }
      }

      for (const child of Object.values(value)) {
        link(child, references);
      }
    };

    link(root);

    for (const [name, definition] of Object.entries($defs)) {
      if (anonymous.has(name)) {
        link(definition);
      } else {
        const references = new Set<string>();

        link(definition, references);
        this.#addNamed(name, io, {
          schema: definition as SchemaObject,
          // Anonymous definitions are numbered per conversion.
          json: JSON.stringify(definition).replaceAll(
            ANONYMOUS_REFERENCE,
            `"${DEFS}${ANONYMOUS}"`,
          ),
          references,
        });
      }
    }

    if (rootReferences.length > 0) {
      // "#" means the document root in OpenAPI: the root becomes a component.
      const key = ++this.#anonymousCount;
      const reference: SchemaObject = { $ref: "#" };

      this.#anonymous.set(key, root);

      for (const holder of [...rootReferences, reference]) {
        this.#targets.set(holder, { kind: "anonymous", key });
      }

      return { schema: reference, resolved: root };
    }

    const target = this.#targets.get(root);

    return {
      schema: root,
      // A reference at the top is always to a named definition: without
      // `id`, only recursion creates definitions, and the root is "#".
      resolved: target?.kind === "named"
        ? this.#named.get(target.id)![io]!.schema
        : root,
    };
  }

  /**
   * Rewrites the references reachable from `document` to
   * `#/components/schemas/<name>` and returns the referenced schemas.
   * Schemas that are only used without reference (e.g. a query schema whose
   * properties became parameters) are left out.
   *
   * @param {unknown} document - The document, or the part holding every use.
   * @param {Iterable<string>} reserved - Names already used in
   *   `components.schemas`.
   * @return {Record<string, SchemaObject>} The schemas by name, sorted.
   * @throws {Error} When a generated name is already used.
   */
  public finalize(
    document: unknown,
    reserved: Iterable<string>,
  ): Record<string, SchemaObject> {
    const references: { holder: SchemaObject; target: ReferenceTarget }[] = [];
    const reachedNamed = new Map<string, Set<SchemaIo>>();
    const reachedAnonymous = new Set<number>();

    const walk = (value: unknown): void => {
      if (typeof value !== "object" || value === null) {
        return;
      }

      const target = this.#targets.get(value);

      if (target !== undefined) {
        references.push({ holder: value as SchemaObject, target });

        if (target.kind === "named") {
          const reached = reachedNamed.get(target.id) ?? new Set();

          if (!reached.has(target.io)) {
            reachedNamed.set(target.id, reached.add(target.io));
            walk(this.#named.get(target.id)![target.io]!.schema);
          }
        } else if (!reachedAnonymous.has(target.key)) {
          reachedAnonymous.add(target.key);
          walk(this.#anonymous.get(target.key));
        }
      }

      for (const child of Object.values(value)) {
        walk(child);
      }
    };

    walk(document);

    const split = this.#splitIds(reachedNamed);
    const nameOf = (id: string, io: SchemaIo): string =>
      io === "output" && split.has(id) ? `${id}Output` : id;
    const components = new Map<string, SchemaObject>();
    const taken = new Set(reserved);
    const claim = (name: string, schema: SchemaObject): void => {
      if (taken.has(name)) {
        throw new Error(
          `The schema name "${name}" is used twice in components.schemas; ` +
            "rename the zod schema id or the schema of the document options.",
        );
      }

      taken.add(name);
      components.set(name, schema);
    };

    for (const [id, reached] of reachedNamed) {
      const variants = this.#named.get(id)!;

      if (split.has(id)) {
        claim(nameOf(id, "input"), variants.input!.schema);
        claim(nameOf(id, "output"), variants.output!.schema);
      } else {
        claim(id, variants[reached.has("input") ? "input" : "output"]!.schema);
      }
    }

    const anonymousNames = new Map<number, string>();
    let count = 0;

    for (const key of reachedAnonymous) {
      let name: string;

      do {
        name = `Schema${++count}`;
      } while (taken.has(name));

      anonymousNames.set(key, name);
      claim(name, this.#anonymous.get(key)!);
    }

    for (const { holder, target } of references) {
      holder.$ref = COMPONENTS +
        (target.kind === "named"
          ? nameOf(target.id, target.io)
          : anonymousNames.get(target.key)!);
    }

    return Object.fromEntries(
      [...components.keys()].sort().map((name) => [
        name,
        components.get(name)!,
      ]),
    );
  }

  /**
   * Stores the definition of a zod schema with an `id`. A definition seen
   * before is kept.
   *
   * @param {string} id - The id.
   * @param {SchemaIo} io - Direction of the definition.
   * @param {NamedVariant} variant - The definition.
   * @return {void}
   * @throws {Error} When another definition with the same id and direction
   *   was stored before.
   */
  #addNamed(id: string, io: SchemaIo, variant: NamedVariant): void {
    const variants = this.#named.get(id) ?? {};
    const existing = variants[io];

    if (existing === undefined) {
      variants[io] = variant;
      this.#named.set(id, variants);
    } else if (existing.json !== variant.json) {
      throw new Error(
        `Two different zod schemas use the id "${id}"; ids must be unique.`,
      );
    }
  }

  /**
   * Returns the ids that need separate input and output schemas: both
   * directions are used and differ, or reference an id that is split.
   *
   * @param {Map<string, Set<SchemaIo>>} reached - Used directions by id.
   * @return {Set<string>} The ids to split.
   */
  #splitIds(reached: Map<string, Set<SchemaIo>>): Set<string> {
    const both = [...reached]
      .filter(([, directions]) => directions.size === 2)
      .map(([id]) => ({ id, ...this.#named.get(id)! }));
    const split = new Set(
      both
        .filter(({ input, output }) => input!.json !== output!.json)
        .map(({ id }) => id),
    );
    let changed = true;

    while (changed) {
      changed = false;

      for (const { id, input, output } of both) {
        if (
          !split.has(id) &&
          [...input!.references, ...output!.references].some((ref) =>
            split.has(ref)
          )
        ) {
          split.add(id);
          changed = true;
        }
      }
    }

    return split;
  }
}
