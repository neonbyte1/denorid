import { InvalidStaticMemberDecoratorUsageError } from "@denorid/injector";
import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import { z, type ZodType } from "zod";
import { WEBSOCKET_MESSAGE_BODY } from "../_constants.ts";
import { getMessageBodySchema } from "./_metadata.ts";
import { MessageBody } from "./message_body.ts";

describe(MessageBody.name, () => {
  const first = z.object({ text: z.string() });
  const second = z.string();

  it("stores the schema per method", () => {
    class Gateway {
      @MessageBody(first)
      public send(): void {}

      public ping(): void {}
    }

    assertStrictEquals(getMessageBodySchema(Gateway, "send"), first);
    assertStrictEquals(getMessageBodySchema(Gateway, "ping"), undefined);
  });

  it("keeps the outermost schema when applied twice", () => {
    class Gateway {
      @MessageBody(second)
      @MessageBody(first)
      public send(): void {}
    }

    assertStrictEquals(getMessageBodySchema(Gateway, "send"), second);
  });

  it("copies inherited schemas instead of changing the parent class", () => {
    const parent = { [WEBSOCKET_MESSAGE_BODY]: new Map([["send", first]]) };
    // Spec compliant runtimes link the metadata of a subclass to the parent's.
    const metadata = Object.create(parent) as DecoratorMetadataObject;

    MessageBody(second)(() => {}, {
      kind: "method",
      name: "send",
      static: false,
      private: false,
      metadata,
    } as ClassMethodDecoratorContext);

    assertEquals([...parent[WEBSOCKET_MESSAGE_BODY]], [["send", first]]);
    assertEquals(
      [...metadata[WEBSOCKET_MESSAGE_BODY] as Map<string, ZodType>],
      [["send", second]],
    );
  });

  it("throws on static methods", () => {
    assertThrows(
      () => {
        class Gateway {
          @MessageBody(first)
          public static send(): void {}
        }

        return Gateway;
      },
      InvalidStaticMemberDecoratorUsageError,
      'Decorator @MessageBody() cannot be applied to static function "send".',
    );
  });
});
