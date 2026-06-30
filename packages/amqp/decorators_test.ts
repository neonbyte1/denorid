import {
  getTags,
  InvalidStaticMemberDecoratorUsageError,
  type Type,
} from "@denorid/injector";
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { AMQP_CONSUMER } from "./_constants.ts";
import { type AmqpBinding, getAmqpBindings } from "./_metadata.ts";
import {
  AmqpConsumer,
  PubSub,
  Routing,
  Rpc,
  Topic,
  Worker,
} from "./decorators.ts";

function bindings(target: Type): AmqpBinding[] {
  return getAmqpBindings(target) ?? [];
}

describe(AmqpConsumer.name, () => {
  it("tags the class with AMQP_CONSUMER", () => {
    @AmqpConsumer()
    class Consumer {}

    assertEquals(getTags(Consumer), [AMQP_CONSUMER]);
  });
});

describe("amqp method decorators", () => {
  it("Worker records a worker binding with the method and options", () => {
    @AmqpConsumer()
    class Consumer {
      @Worker({ queue: "tasks", prefetch: 5 })
      run(): void {}
    }

    assertEquals(bindings(Consumer), [
      {
        type: "worker",
        method: "run",
        options: { queue: "tasks", prefetch: 5 },
      },
    ]);
  });

  it("PubSub records a pub-sub binding", () => {
    @AmqpConsumer()
    class Consumer {
      @PubSub({ exchange: "logs" })
      onLog(): void {}
    }

    assertEquals(bindings(Consumer), [
      { type: "pub-sub", method: "onLog", options: { exchange: "logs" } },
    ]);
  });

  it("Routing records a routing binding", () => {
    @AmqpConsumer()
    class Consumer {
      @Routing({ exchange: "alerts", routingKeys: ["error"] })
      onAlert(): void {}
    }

    assertEquals(bindings(Consumer), [
      {
        type: "routing",
        method: "onAlert",
        options: { exchange: "alerts", routingKeys: ["error"] },
      },
    ]);
  });

  it("Topic records a topic binding", () => {
    @AmqpConsumer()
    class Consumer {
      @Topic({ exchange: "metrics", routingKeys: ["cpu.*"] })
      onMetric(): void {}
    }

    assertEquals(bindings(Consumer), [
      {
        type: "topic",
        method: "onMetric",
        options: { exchange: "metrics", routingKeys: ["cpu.*"] },
      },
    ]);
  });

  it("Rpc records an rpc binding", () => {
    @AmqpConsumer()
    class Consumer {
      @Rpc({ queue: "math.add" })
      add(): number {
        return 0;
      }
    }

    assertEquals(bindings(Consumer), [
      { type: "rpc", method: "add", options: { queue: "math.add" } },
    ]);
  });

  it("accumulates one binding per decorated method", () => {
    @AmqpConsumer()
    class Consumer {
      @Worker({ queue: "a" })
      first(): void {}

      @Rpc({ queue: "b" })
      second(): void {}
    }

    assertEquals(bindings(Consumer).map((b) => [b.type, b.method]), [
      ["worker", "first"],
      ["rpc", "second"],
    ]);
  });

  it("returns undefined when a class has no bindings", () => {
    class Bare {}

    assertEquals(getAmqpBindings(Bare), undefined);
  });

  it("throws when applied to a static method", () => {
    const error = assertThrows(
      () => {
        class Consumer {
          @Worker({ queue: "tasks" })
          static run(): void {}
        }

        return Consumer;
      },
      InvalidStaticMemberDecoratorUsageError,
    );

    assertEquals(
      error.message,
      'Decorator @Worker() cannot be applied to static function "run".',
    );
  });
});
