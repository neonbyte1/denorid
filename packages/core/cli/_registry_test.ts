import { Global, InjectorContext, Module, type Type } from "@denorid/injector";
import { Logger } from "@denorid/logger";
import { assertEquals, assertThrows } from "@std/assert";
import { stub } from "@std/testing/mock";
import { describe, it } from "node:test";
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

  it("registers the command of a @Global() module once", async () => {
    @ConsoleCommand({ command: "db:seed" })
    class SeedCommand {
      public execute(): number {
        return 0;
      }
    }

    @Global()
    @Module({ providers: [SeedCommand], exports: [SeedCommand] })
    class DbModule {}

    @Module({ imports: [DbModule] })
    class AppModule {}

    using _log = stub(Logger.prototype, "log");
    await using ctx = await InjectorContext.create(AppModule, {
      useGlobals: true,
    });

    assertEquals([...buildCommandRegistry(ctx).keys()], ["db:seed"]);
  });

  it("throws for the names of the built-in list and help commands", () => {
    @ConsoleCommand({ command: "list" })
    class ListCommand {
      public execute(): number {
        return 0;
      }
    }

    @ConsoleCommand({ command: "help" })
    class HelpCommand {
      public execute(): number {
        return 0;
      }
    }

    assertThrows(
      () => buildCommandRegistry(makeCtx([ListCommand])),
      Error,
      'Console command "list" (ListCommand) uses the name of a built-in command.',
    );
    assertThrows(
      () => buildCommandRegistry(makeCtx([HelpCommand])),
      Error,
      'Console command "help" (HelpCommand) uses the name of a built-in command.',
    );
  });

  it("throws for names argv can never select", () => {
    @ConsoleCommand({ command: "" })
    class EmptyCommand {
      public execute(): number {
        return 0;
      }
    }

    @ConsoleCommand({ command: "-run" })
    class DashCommand {
      public execute(): number {
        return 0;
      }
    }

    assertThrows(
      () => buildCommandRegistry(makeCtx([EmptyCommand])),
      Error,
      'Console command "" (EmptyCommand) needs a name that is not empty and does not start with "-".',
    );
    assertThrows(
      () => buildCommandRegistry(makeCtx([DashCommand])),
      Error,
      'Console command "-run" (DashCommand) needs a name',
    );
  });

  it("throws when an option reuses a name or shortcut of the global options", () => {
    @ConsoleCommand({ command: "serve" })
    @Option({ name: "host", shortcut: "h", type: "string" })
    class ServeCommand {
      public execute(): number {
        return 0;
      }
    }

    @ConsoleCommand({ command: "paint", options: [{ name: "no-color" }] })
    class PaintCommand {
      public execute(): number {
        return 0;
      }
    }

    assertThrows(
      () => buildCommandRegistry(makeCtx([ServeCommand])),
      Error,
      'Console command "serve" (ServeCommand) declares the "-h" shortcut, which is reserved for the global "--help" option.',
    );
    assertThrows(
      () => buildCommandRegistry(makeCtx([PaintCommand])),
      Error,
      'Console command "paint" (PaintCommand) declares the "--no-color" option, which is reserved for the global "--no-color" option.',
    );
  });

  it("throws when a command declares an option name or shortcut twice", () => {
    @ConsoleCommand({
      command: "twice:name",
      options: [{ name: "scope" }, { name: "scope" }],
    })
    class TwiceName {
      public execute(): number {
        return 0;
      }
    }

    @ConsoleCommand({ command: "twice:shortcut" })
    @Option({ name: "alpha", shortcut: "a", type: "boolean" })
    @Option({ name: "all", shortcut: "a", type: "boolean" })
    class TwiceShortcut {
      public execute(): number {
        return 0;
      }
    }

    assertThrows(
      () => buildCommandRegistry(makeCtx([TwiceName])),
      Error,
      'Console command "twice:name" (TwiceName) declares the "--scope" option more than once.',
    );
    assertThrows(
      () => buildCommandRegistry(makeCtx([TwiceShortcut])),
      Error,
      'Console command "twice:shortcut" (TwiceShortcut) declares the "-a" shortcut more than once.',
    );
  });
});
