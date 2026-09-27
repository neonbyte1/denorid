import { InvalidStaticMemberDecoratorUsageError } from "@denorid/injector";
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import { WEBSOCKET_SERVER } from "../_constants.ts";
import { getWebSocketServerFields } from "./_metadata.ts";
import { WebSocketServer } from "./web_socket_server.ts";

describe(WebSocketServer.name, () => {
  it("records the decorated fields", () => {
    class Gateway {
      @WebSocketServer()
      public server: unknown;

      @WebSocketServer()
      protected io: unknown;
    }

    assertEquals([...getWebSocketServerFields(Gateway)], ["server", "io"]);
  });

  it("copies inherited fields instead of changing the parent class", () => {
    const parent = { [WEBSOCKET_SERVER]: new Set(["server"]) };
    // Spec compliant runtimes link the metadata of a subclass to the parent's.
    const metadata = Object.create(parent) as DecoratorMetadataObject;

    WebSocketServer()(undefined, {
      kind: "field",
      name: "io",
      static: false,
      private: false,
      metadata,
    } as ClassFieldDecoratorContext);

    assertEquals([...parent[WEBSOCKET_SERVER]], ["server"]);
    assertEquals([...metadata[WEBSOCKET_SERVER] as Set<string>], [
      "server",
      "io",
    ]);
  });

  it("returns no fields for classes without metadata", () => {
    class Plain {}

    Object.defineProperty(Plain, Symbol.metadata, { value: null });

    assertEquals([...getWebSocketServerFields(Plain)], []);
  });

  it("throws on static fields", () => {
    assertThrows(
      () => {
        class Gateway {
          @WebSocketServer()
          public static server: unknown;
        }

        return Gateway;
      },
      InvalidStaticMemberDecoratorUsageError,
      'Decorator @WebSocketServer() cannot be applied to static property "server".',
    );
  });

  it("throws on #private fields", () => {
    assertThrows(
      () => {
        class Gateway {
          @WebSocketServer()
          #server: unknown;
        }

        return Gateway;
      },
      Error,
      'Decorator @WebSocketServer() cannot be applied to private property "#server". Use a member without "#" instead.',
    );
  });
});
