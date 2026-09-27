import { InvalidStaticMemberDecoratorUsageError } from "@denorid/injector";
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import { WEBSOCKET_SUBSCRIBE_MESSAGE } from "../_constants.ts";
import { getSubscribeMessageMetadata } from "./_metadata.ts";
import { SubscribeMessage } from "./subscribe_message.ts";

describe(SubscribeMessage.name, () => {
  it("stores one entry per subscribed event", () => {
    class Gateway {
      @SubscribeMessage("join")
      @SubscribeMessage("enter")
      public join(): void {}

      @SubscribeMessage("leave")
      public leave(): void {}
    }

    assertEquals(getSubscribeMessageMetadata(Gateway), [
      { event: "enter", name: "join" },
      { event: "join", name: "join" },
      { event: "leave", name: "leave" },
    ]);
  });

  it("ignores repeated subscriptions of a method to the same event", () => {
    class Gateway {
      @SubscribeMessage("ping")
      @SubscribeMessage("ping")
      public ping(): void {}
    }

    assertEquals(getSubscribeMessageMetadata(Gateway), [
      { event: "ping", name: "ping" },
    ]);
  });

  it("copies inherited subscriptions instead of changing the parent class", () => {
    const parent = {
      [WEBSOCKET_SUBSCRIBE_MESSAGE]: [{ event: "a", name: "a" }],
    };
    // Spec compliant runtimes link the metadata of a subclass to the parent's.
    const metadata = Object.create(parent) as DecoratorMetadataObject;

    SubscribeMessage("b")(() => {}, {
      kind: "method",
      name: "b",
      static: false,
      private: false,
      metadata,
    } as ClassMethodDecoratorContext);

    assertEquals(parent[WEBSOCKET_SUBSCRIBE_MESSAGE], [
      { event: "a", name: "a" },
    ]);
    assertEquals(metadata[WEBSOCKET_SUBSCRIBE_MESSAGE], [
      { event: "a", name: "a" },
      { event: "b", name: "b" },
    ]);
  });

  it("throws on static methods", () => {
    assertThrows(
      () => {
        class Gateway {
          @SubscribeMessage("ping")
          public static ping(): void {}
        }

        return Gateway;
      },
      InvalidStaticMemberDecoratorUsageError,
      'Decorator @SubscribeMessage() cannot be applied to static function "ping".',
    );
  });

  it("throws on #private methods", () => {
    assertThrows(
      () => {
        class Gateway {
          @SubscribeMessage("ping")
          #ping(): void {}
        }

        return Gateway;
      },
      Error,
      'Decorator @SubscribeMessage() cannot be applied to private function "#ping".',
    );
  });
});
