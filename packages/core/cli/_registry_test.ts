import type { InjectorContext, Type } from "@denorid/injector";
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { buildCommandRegistry } from "./_registry.ts";
import type { ConsoleCommandInput } from "./command_interface.ts";
import { ConsoleCommand, Option } from "./decorator.ts";

function makeCtx(tokens: unknown[]): InjectorContext {
  return {
    container: {
      getTokensByTag: () => tokens,
    },
  } as unknown as InjectorContext;
}

@ConsoleCommand({
  command: "cache:clear",
  description: "Clears the cache",
  help: "Long help",
  options: [{ name: "scope", type: "string", default: "all" }],
})
class ClearCache {
  public execute(_: ConsoleCommandInput): number {
    return 0;
  }
}

@ConsoleCommand({
  command: "user:create",
  description: "Creates a user",
})
@Option({ name: "name", type: "string", required: true })
@Option({ name: "admin", shortcut: "a", type: "boolean" })
class CreateUser {
  public execute(_: ConsoleCommandInput): number {
    return 0;
  }
}

@ConsoleCommand({ command: "cache:clear", description: "Duplicate" })
class ClearCacheDup {
  public execute(_: ConsoleCommandInput): number {
    return 0;
  }
}

class Plain {}

describe("buildCommandRegistry()", () => {
  it("returns an empty map when no tokens are tagged", () => {
    const registry = buildCommandRegistry(makeCtx([]));

    assertEquals(registry.size, 0);
  });

  it("indexes a single decorated command by its declared name", () => {
    const registry = buildCommandRegistry(makeCtx([ClearCache as Type]));

    assertEquals(registry.size, 1);
    const entry = registry.get("cache:clear")!;
    assertEquals(entry.name, "cache:clear");
    assertEquals(entry.description, "Clears the cache");
    assertEquals(entry.help, "Long help");
    assertEquals(entry.token, ClearCache as Type);
  });

  it("merges inline options with stacked @Option declarations in declared order", () => {
    const registry = buildCommandRegistry(makeCtx([CreateUser as Type]));
    const entry = registry.get("user:create")!;

    assertEquals(entry.options.length, 2);
    assertEquals(entry.options[0].name, "name");
    assertEquals(entry.options[0].required, true);
    assertEquals(entry.options[1].name, "admin");
    assertEquals(entry.options[1].shortcut, "a");
  });

  it("preserves inline options on @ConsoleCommand", () => {
    const registry = buildCommandRegistry(makeCtx([ClearCache as Type]));
    const entry = registry.get("cache:clear")!;

    assertEquals(entry.options.length, 1);
    assertEquals(entry.options[0].name, "scope");
    assertEquals(entry.options[0].default, "all");
  });

  it("indexes multiple commands together", () => {
    const registry = buildCommandRegistry(
      makeCtx([ClearCache as Type, CreateUser as Type]),
    );

    assertEquals(registry.size, 2);
    assertEquals(registry.has("cache:clear"), true);
    assertEquals(registry.has("user:create"), true);
  });

  it("skips tokens whose constructor has no command metadata", () => {
    const registry = buildCommandRegistry(
      makeCtx([Plain as Type, ClearCache as Type]),
    );

    assertEquals(registry.size, 1);
    assertEquals(registry.has("cache:clear"), true);
  });

  it("skips non-function tokens", () => {
    const registry = buildCommandRegistry(
      makeCtx(["string-token", Symbol("symbol-token"), ClearCache as Type]),
    );

    assertEquals(registry.size, 1);
    assertEquals(registry.has("cache:clear"), true);
  });

  it("throws when two commands share a name", () => {
    assertThrows(
      () =>
        buildCommandRegistry(
          makeCtx([ClearCache as Type, ClearCacheDup as Type]),
        ),
      Error,
      'Duplicate console command "cache:clear"',
    );
  });
});
