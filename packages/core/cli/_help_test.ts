import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { OutputFormatter } from "./_formatter.ts";
import { type CommandSummary, HelpRenderer } from "./_help.ts";
import type { InputOption } from "./options.ts";

function makeRenderer(decorated: boolean = false): HelpRenderer {
  return new HelpRenderer(new OutputFormatter(decorated), "TestApp");
}

describe("HelpRenderer.renderCommandHelp()", () => {
  it("omits the Description block when the summary has no description", () => {
    const summary: CommandSummary = { name: "noop", options: [] };

    const out = makeRenderer().renderCommandHelp(summary);

    assertEquals(out.includes("Description:"), false);
    assertStringIncludes(out, "Usage:");
    assertStringIncludes(out, "noop [options]");
  });

  it("omits the Help block when the summary has no help body", () => {
    const summary: CommandSummary = {
      name: "noop",
      description: "no help body",
      options: [],
    };

    const out = makeRenderer().renderCommandHelp(summary);

    assertStringIncludes(out, "no help body");
    assertEquals(out.includes("Help:"), false);
  });

  it("splits a multi-line help body across rendered lines", () => {
    const summary: CommandSummary = {
      name: "noop",
      help: "line one\nline two",
      options: [],
    };

    const out = makeRenderer().renderCommandHelp(summary);

    assertStringIncludes(out, "  line one");
    assertStringIncludes(out, "  line two");
  });

  it("renders an array option with the multiple-values hint", () => {
    const opt: InputOption = {
      name: "tag",
      shortcut: "t",
      type: "string",
      array: true,
      description: "Tag to apply",
    };
    const summary: CommandSummary = { name: "tagger", options: [opt] };

    const out = makeRenderer().renderCommandHelp(summary);

    assertStringIncludes(out, "-t, --tag=TAG");
    assertStringIncludes(out, "Tag to apply (multiple values allowed)");
  });

  it("renders a string default in quotes", () => {
    const opt: InputOption = {
      name: "scope",
      type: "string",
      default: "all",
    };
    const summary: CommandSummary = { name: "cache", options: [opt] };

    const out = makeRenderer().renderCommandHelp(summary);

    assertStringIncludes(out, `(default: "all")`);
  });

  it("renders a numeric default unquoted", () => {
    const opt: InputOption = {
      name: "depth",
      type: "number",
      default: 5,
    };
    const summary: CommandSummary = { name: "walk", options: [opt] };

    const out = makeRenderer().renderCommandHelp(summary);

    assertStringIncludes(out, "(default: 5)");
  });

  it("renders an array default as a bracketed comma list", () => {
    const opt: InputOption = {
      name: "tag",
      type: "string",
      array: true,
      default: ["a", "b"],
    };
    const summary: CommandSummary = { name: "tagger", options: [opt] };

    const out = makeRenderer().renderCommandHelp(summary);

    assertStringIncludes(out, `(multiple values allowed)`);
    assertStringIncludes(out, `(default: ["a", "b"])`);
  });

  it("does not render a default for boolean options even when one is set", () => {
    const opt: InputOption = {
      name: "force",
      shortcut: "f",
      type: "boolean",
      default: true,
    };
    const summary: CommandSummary = { name: "rm", options: [opt] };

    const out = makeRenderer().renderCommandHelp(summary);

    assertStringIncludes(out, "-f, --force");
    assertEquals(out.includes("(default:"), false);
  });

  it("uses four-space padding when an option has no shortcut", () => {
    const opt: InputOption = { name: "verbose", type: "boolean" };
    const summary: CommandSummary = { name: "task", options: [opt] };

    const out = makeRenderer().renderCommandHelp(summary);

    assertStringIncludes(out, "    --verbose");
  });
});

describe("HelpRenderer.renderCommandList()", () => {
  function summary(
    name: string,
    description?: string,
  ): CommandSummary {
    return { name, description, options: [] };
  }

  it("shows the (no commands registered) hint when the registry is empty", () => {
    const out = makeRenderer().renderCommandList([]);

    assertStringIncludes(out, "TestApp");
    assertStringIncludes(out, "Available commands:");
    assertStringIncludes(out, "(no commands registered)");
  });

  it("lists root commands above namespaced groups", () => {
    const commands: CommandSummary[] = [
      summary("migrate", "Run migrations"),
      summary("cache:clear", "Clear cache"),
    ];

    const out = makeRenderer().renderCommandList(commands);
    const lines = out.split("\n");
    const migrateIdx = lines.findIndex((l) => l.includes("migrate"));
    const cacheHeaderIdx = lines.findIndex((l) => l.trimStart() === "cache");
    const cacheClearIdx = lines.findIndex((l) => l.includes("cache:clear"));

    assertStringIncludes(out, "Run migrations");
    assertStringIncludes(out, "Clear cache");
    assertEquals(migrateIdx > 0, true);
    assertEquals(cacheHeaderIdx > migrateIdx, true);
    assertEquals(cacheClearIdx > cacheHeaderIdx, true);
  });

  it("groups multiple commands sharing a namespace under one header", () => {
    const commands: CommandSummary[] = [
      summary("cache:clear", "Clear cache"),
      summary("cache:warm", "Warm cache"),
      summary("user:create", "Create user"),
    ];

    const out = makeRenderer().renderCommandList(commands);
    const lines = out.split("\n");
    const cacheHeader = lines.filter((l) => l.trimStart() === "cache").length;
    const userHeader = lines.filter((l) => l.trimStart() === "user").length;

    assertEquals(cacheHeader, 1);
    assertEquals(userHeader, 1);
    assertStringIncludes(out, "cache:clear");
    assertStringIncludes(out, "cache:warm");
    assertStringIncludes(out, "user:create");
  });

  it("sorts commands by name within each namespace", () => {
    const commands: CommandSummary[] = [
      summary("cache:warm"),
      summary("cache:clear"),
    ];

    const out = makeRenderer().renderCommandList(commands);
    const clearIdx = out.indexOf("cache:clear");
    const warmIdx = out.indexOf("cache:warm");

    assertEquals(clearIdx < warmIdx, true);
  });

  it("renders rows gracefully when a command has no description", () => {
    const commands: CommandSummary[] = [summary("bare")];

    const out = makeRenderer().renderCommandList(commands);

    assertStringIncludes(out, "bare");
  });
});
