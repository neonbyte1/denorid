import {
  getTags,
  InvalidStaticMemberDecoratorUsageError,
} from "@denorid/injector";
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  DEFAULT_QUEUE_NAME,
  QUEUE_HANDLER,
  QUEUE_HANDLER_METADATA,
} from "../_constants.ts";
import { Queued, QueueHandler } from "./decorator.ts";
import type { MessageMetadata } from "./_metadata.ts";

class Dto {}

function getQueueMetadata(target: typeof QueueHandlerTestTarget) {
  return target[Symbol.metadata]![QUEUE_HANDLER_METADATA] as MessageMetadata[];
}

@QueueHandler()
class QueueHandlerTestTarget {}

describe(QueueHandler.name, () => {
  it("marks a class as a default queue handler", () => {
    assertEquals(
      QueueHandlerTestTarget[Symbol.metadata]![QUEUE_HANDLER],
      DEFAULT_QUEUE_NAME,
    );
    assertEquals(getTags(QueueHandlerTestTarget), [QUEUE_HANDLER]);
  });

  it("marks a class as a named queue handler", () => {
    @QueueHandler("emails")
    class EmailHandler {}

    assertEquals(EmailHandler[Symbol.metadata]![QUEUE_HANDLER], "emails");
    assertEquals(getTags(EmailHandler), [QUEUE_HANDLER]);
  });
});

describe(Queued.name, () => {
  it("stores metadata for event-only usage", () => {
    class Handler {
      @Queued("user.created")
      handle() {}
    }

    assertEquals(getQueueMetadata(Handler), [
      {
        event: "user.created",
        name: undefined,
        dto: undefined,
        method: "handle",
      },
    ]);
  });

  it("stores metadata for event plus dto usage", () => {
    class Handler {
      @Queued("user.created", Dto)
      handle() {}
    }

    assertEquals(getQueueMetadata(Handler), [
      {
        event: "user.created",
        name: undefined,
        dto: Dto,
        method: "handle",
      },
    ]);
  });

  it("stores metadata for event plus queue usage", () => {
    class Handler {
      @Queued("user.created", "emails")
      handle() {}
    }

    assertEquals(getQueueMetadata(Handler), [
      {
        event: "user.created",
        name: "emails",
        dto: undefined,
        method: "handle",
      },
    ]);
  });

  it("stores metadata for event plus dto plus queue usage", () => {
    class Handler {
      @Queued("user.created", Dto, "emails")
      handle() {}
    }

    assertEquals(getQueueMetadata(Handler), [
      { event: "user.created", name: "emails", dto: Dto, method: "handle" },
    ]);
  });

  it("stores metadata for event plus queue plus dto usage", () => {
    class Handler {
      @Queued("user.created", "emails", Dto)
      handle() {}
    }

    assertEquals(getQueueMetadata(Handler), [
      { event: "user.created", name: "emails", dto: Dto, method: "handle" },
    ]);
  });

  it("stores metadata object usage", () => {
    const event = /^user\.(created)$/;

    class Handler {
      @Queued({ event, name: "emails", dto: Dto })
      handle() {}
    }

    assertEquals(getQueueMetadata(Handler), [
      { event, name: "emails", dto: Dto, method: "handle" },
    ]);
  });

  it("accumulates metadata for multiple queued methods", () => {
    class Handler {
      @Queued("one")
      one() {}

      @Queued("two")
      two() {}
    }

    assertEquals(getQueueMetadata(Handler), [
      { event: "one", name: undefined, dto: undefined, method: "one" },
      { event: "two", name: undefined, dto: undefined, method: "two" },
    ]);
  });

  it("throws when used on a static method", () => {
    const error = assertThrows(
      () => {
        class Handler {
          @Queued("static")
          static handle() {}
        }

        return Handler;
      },
      InvalidStaticMemberDecoratorUsageError,
    );

    assertEquals(
      error.message,
      'Decorator @Queued() cannot be applied to static function "handle".',
    );
  });
});
