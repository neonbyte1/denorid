import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import { z } from "zod";
import { SchemaCollector } from "./_schemas.ts";

interface TreeNode {
  name: string;
  children: TreeNode[];
}

describe("SchemaCollector", () => {
  it("inlines schemas without id and adds no component", () => {
    const schemas = new SchemaCollector();
    const { schema, resolved } = schemas.convert(
      z.object({ name: z.string().describe("Name") }),
      "input",
    );

    assertStrictEquals(resolved, schema);
    assertEquals(schema, {
      type: "object",
      properties: { name: { type: "string", description: "Name" } },
      required: ["name"],
    });
    assertEquals(schemas.finalize({ schema }, []), {});
  });

  it("references schemas with id and resolves them", () => {
    const Role = z.enum(["admin", "user"]).meta({ id: "SchemasRole" });
    const User = z.object({ role: Role }).meta({ id: "SchemasUser" });
    const schemas = new SchemaCollector();
    const { schema, resolved } = schemas.convert(User, "input");

    assertEquals(resolved.properties, {
      role: { $ref: "#/$defs/SchemasRole" },
    });
    assertEquals(schemas.finalize({ schema }, []), {
      SchemasRole: { type: "string", enum: ["admin", "user"] },
      SchemasUser: {
        type: "object",
        properties: { role: { $ref: "#/components/schemas/SchemasRole" } },
        required: ["role"],
      },
    });
    assertEquals(schema, { $ref: "#/components/schemas/SchemasUser" });
  });

  it("splits a schema whose input and output differ into <id> and <id>Output", () => {
    const User = z.object({ role: z.string().default("user") }).meta({
      id: "SplitUser",
    });
    const schemas = new SchemaCollector();
    const input = schemas.convert(User, "input").schema;
    const output = schemas.convert(User, "output").schema;
    const components = schemas.finalize({ input, output }, []);

    assertEquals(Object.keys(components), ["SplitUser", "SplitUserOutput"]);
    assertEquals(components.SplitUser.required, undefined);
    assertEquals(components.SplitUserOutput.required, ["role"]);
    assertEquals(input, { $ref: "#/components/schemas/SplitUser" });
    assertEquals(output, { $ref: "#/components/schemas/SplitUserOutput" });
  });

  it("keeps one component when input and output are the same", () => {
    const Role = z.enum(["admin", "user"]).meta({ id: "SameRole" });
    const schemas = new SchemaCollector();
    const input = schemas.convert(Role, "input").schema;
    const output = schemas.convert(Role, "output").schema;

    assertEquals(Object.keys(schemas.finalize({ input, output }, [])), [
      "SameRole",
    ]);
    assertEquals(input, output);
  });

  it("splits a schema referencing a split schema", () => {
    const Item = z.object({ count: z.number().default(1) }).meta({
      id: "TransitiveItem",
    });
    const Items = z.array(Item).meta({ id: "TransitiveItems" });
    const schemas = new SchemaCollector();
    const input = schemas.convert(Items, "input").schema;
    const output = schemas.convert(Items, "output").schema;
    const components = schemas.finalize({ input, output }, []);

    assertEquals(components.TransitiveItems.items, {
      $ref: "#/components/schemas/TransitiveItem",
    });
    assertEquals(components.TransitiveItemsOutput.items, {
      $ref: "#/components/schemas/TransitiveItemOutput",
    });
  });

  it("leaves out schemas that are not referenced from the document", () => {
    const Hidden = z.object({ id: z.string() }).meta({ id: "UnusedHidden" });
    const Query = z.object({ hidden: Hidden }).meta({ id: "UnusedQuery" });
    const schemas = new SchemaCollector();
    const { resolved } = schemas.convert(Query, "input");

    assertEquals(schemas.finalize({ parameter: {} }, []), {});
    assertEquals(resolved.properties?.hidden, {
      $ref: "#/$defs/UnusedHidden",
    });
    assertEquals(
      schemas.finalize({ parameter: resolved.properties?.hidden }, []),
      {
        UnusedHidden: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    );
  });

  it("documents dates as date-time strings", () => {
    const { schema } = new SchemaCollector().convert(
      z.object({ at: z.date() }),
      "output",
    );

    assertEquals(schema.properties?.at, {
      type: "string",
      format: "date-time",
    });
  });

  it("names recursive schemas without id, skipping names in use", () => {
    const Tree: z.ZodType<TreeNode> = z.object({
      name: z.string(),
      get children(): z.ZodArray<z.ZodType<TreeNode>> {
        return z.array(Tree);
      },
    });
    const schemas = new SchemaCollector();
    const root = schemas.convert(Tree, "input");
    const nested = schemas.convert(z.object({ tree: Tree }), "input");
    const components = schemas.finalize(
      { root: root.schema, nested: nested.schema },
      ["Schema1"],
    );

    assertEquals(Object.keys(components), ["Schema2", "Schema3"]);
    assertEquals(root.schema, { $ref: "#/components/schemas/Schema2" });
    assertStrictEquals(root.resolved, components.Schema2);
    assertEquals(components.Schema2.properties?.children, {
      type: "array",
      items: { $ref: "#/components/schemas/Schema2" },
    });
    assertEquals(nested.schema.properties?.tree, {
      $ref: "#/components/schemas/Schema3",
    });
  });

  it("converts the same schema twice into one component", () => {
    const User = z.object({ id: z.string() }).meta({ id: "TwiceUser" });
    const schemas = new SchemaCollector();
    const first = schemas.convert(User, "input").schema;
    const second = schemas.convert(z.array(User), "input").schema;

    assertEquals(Object.keys(schemas.finalize({ first, second }, [])), [
      "TwiceUser",
    ]);
    assertEquals(second.items, { $ref: "#/components/schemas/TwiceUser" });
  });

  it("throws when two different schemas use the same id", () => {
    const schemas = new SchemaCollector();

    schemas.convert(z.object({ a: z.string() }).meta({ id: "DupId" }), "input");

    assertThrows(
      () =>
        schemas.convert(
          z.object({ b: z.string() }).meta({ id: "DupId" }),
          "input",
        ),
      Error,
      'Two different zod schemas use the id "DupId"',
    );
  });

  it("throws when a generated name is already used", () => {
    const schemas = new SchemaCollector();
    const { schema } = schemas.convert(
      z.string().meta({ id: "TakenName" }),
      "input",
    );

    assertThrows(
      () => schemas.finalize({ schema }, ["TakenName"]),
      Error,
      'The schema name "TakenName" is used twice',
    );
  });

  it("throws when an output name collides with another id", () => {
    const User = z.object({ n: z.number().default(1) }).meta({
      id: "Clash",
    });
    const Other = z.string().meta({ id: "ClashOutput" });
    const schemas = new SchemaCollector();
    const document = {
      input: schemas.convert(User, "input").schema,
      output: schemas.convert(User, "output").schema,
      other: schemas.convert(Other, "input").schema,
    };

    assertThrows(
      () => schemas.finalize(document, []),
      Error,
      'The schema name "ClashOutput" is used twice',
    );
  });
});
