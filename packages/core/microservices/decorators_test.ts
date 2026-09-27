import { InvalidStaticMemberDecoratorUsageError } from "@denorid/injector";
import { assertArrayIncludes, assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import { MESSAGE_PATTERN_METADATA } from "../_constants.ts";
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

  it("throws on #private methods", () => {
    assertThrows(
      () => {
        class Ctrl {
          @MessagePattern("find")
          #find(): void {}
        }
        return Ctrl;
      },
      Error,
      'Decorator @MessagePattern() cannot be applied to private function "#find".',
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

  it("throws on #private methods", () => {
    assertThrows(
      () => {
        class Ctrl {
          @EventPattern("created")
          #created(): void {}
        }
        return Ctrl;
      },
      Error,
      'Decorator @EventPattern() cannot be applied to private function "#created".',
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

  it("keeps the handlers of a parent controller when a subclass adds and overrides some", () => {
    @MessageController()
    class BaseCtrl {
      @MessagePattern("find")
      find(): void {}
    }

    @MessageController()
    class UsersCtrl extends BaseCtrl {
      @MessagePattern("users.find")
      override find(): void {}

      @EventPattern("users.created")
      created(): void {}
    }

    assertEquals(getMessageMappingMetadata(BaseCtrl), [
      { pattern: "find", name: "find", type: "message" },
    ]);
    assertEquals(getMessageMappingMetadata(UsersCtrl), [
      { pattern: "users.find", name: "find", type: "message" },
      { pattern: "users.created", name: "created", type: "event" },
    ]);
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

  it("copies inherited entries instead of changing the parent class", () => {
    const parent = {
      [MESSAGE_PATTERN_METADATA]: [
        { pattern: "find", name: "find", type: "message" },
        { pattern: "created", name: "created", type: "event" },
      ],
    };
    // Spec compliant runtimes link the metadata of a subclass to the parent's.
    const metadata = Object.create(parent) as DecoratorMetadataObject;
    const context = (name: string): ClassMethodDecoratorContext =>
      ({
        kind: "method",
        name,
        static: false,
        private: false,
        metadata,
      }) as ClassMethodDecoratorContext;

    MessagePattern("users.find")(() => {}, context("find"));
    EventPattern("updated")(() => {}, context("updated"));

    assertEquals(parent[MESSAGE_PATTERN_METADATA], [
      { pattern: "find", name: "find", type: "message" },
      { pattern: "created", name: "created", type: "event" },
    ]);
    assertEquals(metadata[MESSAGE_PATTERN_METADATA], [
      { pattern: "users.find", name: "find", type: "message" },
      { pattern: "created", name: "created", type: "event" },
      { pattern: "updated", name: "updated", type: "event" },
    ]);
  });
});
