import { assertEquals, assertStrictEquals } from "@std/assert";
import { describe, it } from "node:test";
import { z } from "zod";
import { createQueryInput } from "./_query_input.ts";

describe(createQueryInput.name, () => {
  const Tags = z.array(z.string());

  it("passes a key given once as a string", () => {
    const schema = z.object({ limit: z.coerce.number() });

    assertEquals(createQueryInput(schema, { limit: ["5"] }), { limit: "5" });
  });

  it("passes a repeated key of a scalar field as all of its values", () => {
    const schema = z.object({ limit: z.coerce.number() });

    assertEquals(createQueryInput(schema, { limit: ["1", "2"] }), {
      limit: ["1", "2"],
    });
  });

  it("passes a key of an array field as all of its values, also when given once", () => {
    const schema = z.object({ tags: Tags });

    assertEquals(createQueryInput(schema, { tags: ["a"] }), { tags: ["a"] });
    assertEquals(createQueryInput(schema, { tags: ["a", "b"] }), {
      tags: ["a", "b"],
    });
  });

  it("recognizes tuple and set fields as arrays", () => {
    const schema = z.object({
      pair: z.tuple([z.string()]),
      unique: z.set(z.string()),
    });

    assertEquals(createQueryInput(schema, { pair: ["a"], unique: ["b"] }), {
      pair: ["a"],
      unique: ["b"],
    });
  });

  it("passes keys the schema does not declare like scalar keys", () => {
    const schema = z.object({ tags: Tags });

    assertEquals(createQueryInput(schema, { page: ["1"], sort: ["a", "b"] }), {
      page: "1",
      sort: ["a", "b"],
    });
  });

  it("looks through the wrappers of an array field", () => {
    const wrapped: Record<string, z.ZodType> = {
      optional: Tags.optional(),
      nullable: Tags.nullable(),
      default: Tags.default([]),
      prefault: Tags.prefault([]),
      catch: Tags.catch([]),
      readonly: Tags.readonly(),
      nonoptional: Tags.optional().nonoptional(),
      pipe: Tags.transform((tags) => tags.length),
      lazy: z.lazy(() => Tags),
      nested: z.lazy(() => Tags.optional()).default([]),
    };

    for (const [name, field] of Object.entries(wrapped)) {
      assertEquals(
        createQueryInput(z.object({ tags: field }), { tags: ["a"] }),
        { tags: ["a"] },
        name,
      );
    }
  });

  it("looks through the wrappers of the query schema", () => {
    const Query = z.object({ tags: Tags });
    const wrapped: Record<string, z.ZodType> = {
      optional: Query.optional(),
      pipe: Query.transform(({ tags }) => tags),
      lazy: z.lazy(() => Query),
    };

    for (const [name, schema] of Object.entries(wrapped)) {
      assertEquals(
        createQueryInput(schema, { tags: ["a"] }),
        { tags: ["a"] },
        name,
      );
    }
  });

  it("uses the input side of a pipe", () => {
    const schema = z.object({
      tags: z.string().transform((value) => value.split(",")),
    });

    assertEquals(createQueryInput(schema, { tags: ["a,b"] }), { tags: "a,b" });
  });

  it("treats a field as an array when any union option accepts an array", () => {
    const schema = z.object({
      tags: z.union([z.string(), Tags]),
      name: z.union([z.string(), z.number()]),
    });

    assertEquals(createQueryInput(schema, { tags: ["a"], name: ["b"] }), {
      tags: ["a"],
      name: "b",
    });
  });

  it("looks up the field in every option of a union schema", () => {
    const schema = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("a"), ids: z.string() }),
      z.object({ kind: z.literal("b"), ids: Tags }),
    ]);

    assertEquals(createQueryInput(schema, { kind: ["a"], ids: ["1"] }), {
      kind: "a",
      ids: ["1"],
    });
  });

  it("treats a field as an array when either side of an intersection accepts an array", () => {
    const schema = z.object({
      left: z.intersection(Tags, z.unknown()),
      right: z.intersection(z.unknown(), Tags),
      none: z.intersection(z.string(), z.string().min(1)),
    });

    assertEquals(
      createQueryInput(schema, { left: ["a"], right: ["b"], none: ["c"] }),
      { left: ["a"], right: ["b"], none: "c" },
    );
  });

  it("looks up the field on both sides of an intersection schema", () => {
    const schema = z.intersection(
      z.object({ page: z.string(), ids: z.string() }),
      z.object({ tags: Tags }),
    );

    assertEquals(
      createQueryInput(schema, { page: ["1"], tags: ["a"] }),
      { page: "1", tags: ["a"] },
    );
    assertEquals(createQueryInput(schema, { ids: ["1"] }), { ids: "1" });
  });

  it("uses the value schema of a record", () => {
    assertEquals(
      createQueryInput(z.record(z.string(), Tags), { a: ["1"] }),
      { a: ["1"] },
    );
    assertEquals(
      createQueryInput(z.record(z.string(), z.string()), { a: ["1"] }),
      { a: "1" },
    );
  });

  it("uses the catchall schema for keys the shape does not declare", () => {
    const schema = z.object({ page: z.string() }).catchall(Tags);

    assertEquals(createQueryInput(schema, { page: ["1"], tag: ["a"] }), {
      page: "1",
      tag: ["a"],
    });
  });

  it("never reads inherited properties of the shape", () => {
    const schema = z.object({ tags: Tags });
    const input = createQueryInput(schema, {
      constructor: ["a"],
      toString: ["b"],
      ["__proto__"]: ["c"],
    });

    assertEquals(Object.entries(input), [
      ["constructor", "a"],
      ["toString", "b"],
      ["__proto__", "c"],
    ]);
    assertStrictEquals(Object.getPrototypeOf(input), Object.prototype);
  });

  it("stops at recursive lazy schemas", () => {
    const Looping: z.ZodType = z.lazy(() => Looping.optional());
    const Branching: z.ZodType = z.lazy(() =>
      z.union([Branching, Branching.optional()])
    );
    const Tree: z.ZodType = z.lazy(() => z.union([Tree, Tags]));
    const endless = (): z.ZodType => z.lazy(() => endless());
    const schema = z.object({
      looping: Looping,
      branching: Branching,
      tree: Tree,
      endless: endless(),
    });

    assertEquals(
      createQueryInput(schema, {
        looping: ["a"],
        branching: ["b"],
        tree: ["c"],
        endless: ["d"],
      }),
      { looping: "a", branching: "b", tree: ["c"], endless: "d" },
    );
  });

  it("passes keys as scalar keys when the schema is no object", () => {
    assertEquals(createQueryInput(z.unknown(), { a: ["1"], b: ["2", "3"] }), {
      a: "1",
      b: ["2", "3"],
    });
  });
});
