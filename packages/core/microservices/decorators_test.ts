import { InvalidStaticMemberDecoratorUsageError } from "@denorid/injector";
import { assertArrayIncludes, assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  EventPattern,
  MessageController,
  MessagePattern,
} from "./decorators.ts";
import { getMessageMappingMetadata } from "./metadata.ts";

describe(MessagePattern.name, () => {
  it("sets type to 'message' on the decorated method", () => {
    class Ctrl {
      @MessagePattern("test.ping")
      ping(): string {
        return "pong";
      }
    }

    const meta = getMessageMappingMetadata(Ctrl);
    assertEquals(meta?.length, 1);
    assertEquals(meta?.[0].pattern, "test.ping");
    assertEquals(meta?.[0].type, "message");
    assertEquals(meta?.[0].name, "ping");
  });

  it("accepts an object pattern", () => {
    class Ctrl {
      @MessagePattern({ cmd: "find" })
      find(): void {}
    }

    const meta = getMessageMappingMetadata(Ctrl);
    assertEquals(meta?.[0].pattern, { cmd: "find" });
  });

  it("throws InvalidStaticMemberDecoratorUsageError on static methods", () => {
    assertThrows(
      () => {
        class Ctrl {
          @MessagePattern("x")
          static method(): void {}
        }
        return Ctrl;
      },
      InvalidStaticMemberDecoratorUsageError,
    );
  });
});

describe(EventPattern.name, () => {
  it("sets type to 'event' on the decorated method", () => {
    class Ctrl {
      @EventPattern("user.created")
      onCreate(): void {}
    }

    const meta = getMessageMappingMetadata(Ctrl);
    assertEquals(meta?.length, 1);
    assertEquals(meta?.[0].pattern, "user.created");
    assertEquals(meta?.[0].type, "event");
  });

  it("accepts an object pattern", () => {
    class Ctrl {
      @EventPattern({ event: "fired" })
      onFired(): void {}
    }

    const meta = getMessageMappingMetadata(Ctrl);
    assertEquals(meta?.[0].pattern, { event: "fired" });
  });

  it("throws InvalidStaticMemberDecoratorUsageError on static methods", () => {
    assertThrows(
      () => {
        class Ctrl {
          @EventPattern("x")
          static method(): void {}
        }
        return Ctrl;
      },
      InvalidStaticMemberDecoratorUsageError,
    );
  });
});

describe(MessageController.name, () => {
  it("makes the class injectable as singleton", () => {
    @MessageController()
    class Svc {}

    const meta = Svc[Symbol.metadata];
    assertEquals(meta !== null && meta !== undefined, true);
  });

  it("registers multiple handlers on the same class", () => {
    @MessageController()
    class Multi {
      @MessagePattern("a")
      handleA(): string {
        return "a";
      }

      @EventPattern("b")
      handleB(): void {}
    }

    const meta = getMessageMappingMetadata(Multi);
    assertEquals(meta?.length, 2);
    assertArrayIncludes(
      meta!.map((m) => m.name),
      ["handleA", "handleB"],
    );
  });
});

describe("createMessageMappingDecorator - upsert behaviour", () => {
  it("does not duplicate entries when the same method is decorated twice", () => {
    class Ctrl {
      @EventPattern("second")
      @MessagePattern("first")
      greet(): void {}
    }

    const meta = getMessageMappingMetadata(Ctrl);
    assertEquals(meta?.length, 1);
    assertEquals(meta?.[0].pattern, "second");
  });
});
