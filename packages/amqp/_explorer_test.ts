import {
  type CanActivate,
  type ExceptionHandler,
  type ExecutionContext,
  ForbiddenException,
  UseGuards,
} from "@denorid/core";
import { InjectorContext, type ModuleRef, type Type } from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { Buffer } from "node:buffer";
import { AMQP_CONSUMER } from "./_constants.ts";
import { AmqpExplorer } from "./_explorer.ts";
import { AmqpConnection } from "./connection.ts";
import {
  AmqpConsumer,
  PubSub,
  Routing,
  Rpc,
  Topic,
  Worker,
} from "./decorators.ts";
import { AmqpHostArguments } from "./host_arguments.ts";
import type { AmqpModuleOptions } from "./module_options.ts";
import { type AmqpSerializer, JsonAmqpSerializer } from "./serialization.ts";

interface RecordedCall {
  method: string;
  args: unknown[];
}

interface FakeChannel {
  calls: RecordedCall[];
  consumeCallback?: (msg: unknown) => void;
  assertQueue: (queue: string, opts: unknown) => Promise<{ queue: string }>;
  assertExchange: (
    exchange: string,
    type: string,
    opts: unknown,
  ) => Promise<unknown>;
  bindQueue: (queue: string, source: string, key: string) => Promise<unknown>;
  prefetch: (count: number) => Promise<unknown>;
  consume: (
    queue: string,
    fn: (msg: unknown) => void,
    opts: unknown,
  ) => Promise<{ consumerTag: string }>;
  sendToQueue: (queue: string, content: Buffer, opts?: unknown) => boolean;
  ack: (msg: unknown) => void;
  nack: (msg: unknown, allUpTo?: boolean, requeue?: boolean) => void;
  close: () => Promise<void>;
}

function makeChannel(generatedQueue = "amq.gen-q"): FakeChannel {
  const channel: FakeChannel = {
    calls: [],
    assertQueue: (queue, opts) => {
      channel.calls.push({ method: "assertQueue", args: [queue, opts] });

      return Promise.resolve({ queue: queue || generatedQueue });
    },
    assertExchange: (exchange, type, opts) => {
      channel.calls.push({
        method: "assertExchange",
        args: [exchange, type, opts],
      });

      return Promise.resolve({ exchange });
    },
    bindQueue: (queue, source, key) => {
      channel.calls.push({ method: "bindQueue", args: [queue, source, key] });

      return Promise.resolve({});
    },
    prefetch: (count) => {
      channel.calls.push({ method: "prefetch", args: [count] });

      return Promise.resolve({});
    },
    consume: (queue, fn, opts) => {
      channel.calls.push({ method: "consume", args: [queue, opts] });
      channel.consumeCallback = fn;

      return Promise.resolve({ consumerTag: "tag" });
    },
    sendToQueue: (queue, content, opts) => {
      channel.calls.push({
        method: "sendToQueue",
        args: [queue, content, opts],
      });

      return true;
    },
    ack: (msg) => {
      channel.calls.push({ method: "ack", args: [msg] });
    },
    nack: (msg, allUpTo, requeue) => {
      channel.calls.push({ method: "nack", args: [msg, allUpTo, requeue] });
    },
    close: () => {
      channel.calls.push({ method: "close", args: [] });

      return Promise.resolve();
    },
  };

  return channel;
}

function makeMessage(opts: {
  payload?: unknown;
  routingKey?: string;
  exchange?: string;
  replyTo?: string;
  correlationId?: string;
  headers?: Record<string, unknown>;
}): unknown {
  return {
    content: Buffer.from(JSON.stringify(opts.payload ?? {})),
    fields: {
      routingKey: opts.routingKey ?? "",
      exchange: opts.exchange ?? "",
      deliveryTag: 1,
      redelivered: false,
      consumerTag: "tag",
    },
    properties: {
      replyTo: opts.replyTo,
      correlationId: opts.correlationId,
      headers: opts.headers,
    },
  };
}

interface Harness {
  explorer: AmqpExplorer;
  channel: FakeChannel;
  exceptionCalls: { err: unknown; host: unknown }[];
  loggerErrors: unknown[][];
  scopes: string[];
}

function createHarness(opts: {
  consumers: Type[];
  instances: Map<Type, unknown>;
  channel?: FakeChannel;
  options?: AmqpModuleOptions;
  serializer?: AmqpSerializer;
}): Harness {
  const channel = opts.channel ?? makeChannel();
  const exceptionCalls: { err: unknown; host: unknown }[] = [];
  const loggerErrors: unknown[][] = [];
  const scopes: string[] = [];

  const connection = {
    createChannel: () => Promise.resolve(channel),
  } as unknown as AmqpConnection;

  const ctx = {
    runInRequestScopeAsync: async (
      contextId: string,
      fn: () => Promise<void>,
    ) => {
      scopes.push(contextId);

      return await fn();
    },
  } as unknown as InjectorContext;

  const moduleRef = {
    getTokensByTag: (tag: unknown) =>
      tag === AMQP_CONSUMER ? opts.consumers : [],
    get: (token: unknown) => {
      if (token === AmqpConnection) {
        return Promise.resolve(connection);
      }

      if (token === InjectorContext) {
        return Promise.resolve(ctx);
      }

      if (opts.instances.has(token as Type)) {
        return Promise.resolve(opts.instances.get(token as Type));
      }

      return Promise.reject(new Error(`Unexpected token: ${String(token)}`));
    },
  } as unknown as ModuleRef;

  const explorer = new AmqpExplorer(moduleRef);

  Object.defineProperty(explorer, "exceptionHandler", {
    value: {
      handle: (err: unknown, host: unknown) => {
        exceptionCalls.push({ err, host });

        return Promise.resolve();
      },
    } as unknown as ExceptionHandler,
  });
  Object.defineProperty(explorer, "options", {
    value: opts.options ?? {},
  });
  Object.defineProperty(explorer, "serializer", {
    value: opts.serializer ?? new JsonAmqpSerializer(),
  });
  Object.defineProperty(explorer, "logger", {
    value: {
      error: (...args: unknown[]) => {
        loggerErrors.push(args);
      },
    },
  });

  return { explorer, channel, exceptionCalls, loggerErrors, scopes };
}

function call(channel: FakeChannel, method: string): RecordedCall | undefined {
  return channel.calls.find((c) => c.method === method);
}

class AllowGuard implements CanActivate {
  public canActivate(_ctx: ExecutionContext): boolean {
    return true;
  }
}

class DenyGuard implements CanActivate {
  public canActivate(_ctx: ExecutionContext): boolean {
    return false;
  }
}

function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);

  return promise;
}

describe(AmqpExplorer.name, () => {
  it("does nothing when there are no consumers", async () => {
    const harness = createHarness({ consumers: [], instances: new Map() });

    await harness.explorer.onApplicationBootstrap();

    assertEquals(harness.channel.calls, []);
  });

  it("skips a tagged consumer that has no bindings", async () => {
    @AmqpConsumer()
    class EmptyConsumer {}

    const harness = createHarness({
      consumers: [EmptyConsumer],
      instances: new Map([[EmptyConsumer, new EmptyConsumer()]]),
    });

    await harness.explorer.onApplicationBootstrap();

    assertEquals(harness.channel.calls, []);
  });

  describe("topology assertion", () => {
    it("worker asserts a durable queue with prefetch", async () => {
      const calls: unknown[][] = [];

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: unknown): void {
          calls.push([payload]);
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      assertEquals(call(harness.channel, "assertQueue")!.args, [
        "tasks",
        { durable: true },
      ]);
      assertEquals(call(harness.channel, "prefetch")!.args, [1]);
      assertEquals(call(harness.channel, "consume")!.args, [
        "tasks",
        { noAck: false },
      ]);
    });

    it("pub-sub asserts a fanout exchange and binds an exclusive queue", async () => {
      @AmqpConsumer()
      class PubSubConsumer {
        @PubSub({ exchange: "logs" })
        onLog(): void {}
      }

      const harness = createHarness({
        consumers: [PubSubConsumer],
        instances: new Map([[PubSubConsumer, new PubSubConsumer()]]),
        channel: makeChannel("gen-fanout"),
      });

      await harness.explorer.onApplicationBootstrap();

      assertEquals(call(harness.channel, "assertExchange")!.args, [
        "logs",
        "fanout",
        { durable: true },
      ]);
      assertEquals(call(harness.channel, "assertQueue")!.args, [
        "",
        { exclusive: true, durable: false, autoDelete: true },
      ]);
      assertEquals(call(harness.channel, "bindQueue")!.args, [
        "gen-fanout",
        "logs",
        "",
      ]);
      assertEquals(call(harness.channel, "consume")!.args[0], "gen-fanout");
    });

    it("routing asserts a direct exchange and binds each routing key", async () => {
      @AmqpConsumer()
      class RoutingConsumer {
        @Routing({ exchange: "alerts", routingKeys: ["error", "warn"] })
        onAlert(): void {}
      }

      const harness = createHarness({
        consumers: [RoutingConsumer],
        instances: new Map([[RoutingConsumer, new RoutingConsumer()]]),
        channel: makeChannel("gen-direct"),
      });

      await harness.explorer.onApplicationBootstrap();

      assertEquals(call(harness.channel, "assertExchange")!.args, [
        "alerts",
        "direct",
        { durable: true },
      ]);

      const binds = harness.channel.calls.filter((c) =>
        c.method === "bindQueue"
      );
      assertEquals(binds.map((b) => b.args[2]), ["error", "warn"]);
    });

    it("topic asserts a topic exchange and binds each pattern", async () => {
      @AmqpConsumer()
      class TopicConsumer {
        @Topic({ exchange: "metrics", routingKeys: ["cpu.*", "mem.#"] })
        onMetric(): void {}
      }

      const harness = createHarness({
        consumers: [TopicConsumer],
        instances: new Map([[TopicConsumer, new TopicConsumer()]]),
        channel: makeChannel("gen-topic"),
      });

      await harness.explorer.onApplicationBootstrap();

      assertEquals(call(harness.channel, "assertExchange")!.args, [
        "metrics",
        "topic",
        { durable: true },
      ]);

      const binds = harness.channel.calls.filter((c) =>
        c.method === "bindQueue"
      );
      assertEquals(binds.map((b) => b.args[2]), ["cpu.*", "mem.#"]);
    });

    it("rpc asserts a non-durable request queue with prefetch", async () => {
      @AmqpConsumer()
      class RpcConsumer {
        @Rpc({ queue: "math.add" })
        add(): number {
          return 0;
        }
      }

      const harness = createHarness({
        consumers: [RpcConsumer],
        instances: new Map([[RpcConsumer, new RpcConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      assertEquals(call(harness.channel, "assertQueue")!.args, [
        "math.add",
        { durable: false },
      ]);
      assertEquals(call(harness.channel, "prefetch")!.args, [1]);
    });
  });

  describe("dispatch", () => {
    it("decodes the payload and passes the message properties to the handler, then acks", async () => {
      const calls: unknown[][] = [];

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: unknown, properties: { correlationId?: string }): void {
          calls.push([payload, properties]);
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({
        payload: { job: 1 },
        routingKey: "tasks",
        correlationId: "corr-x",
        headers: { "x-trace": "abc" },
      }) as { properties: unknown };
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(calls.length, 1);
      assertEquals(calls[0][0], { job: 1 });
      // The second argument is the raw AMQP message properties, not the message.
      assertStrictEquals(calls[0][1], msg.properties);
      assertEquals(
        (calls[0][1] as { correlationId?: string }).correlationId,
        "corr-x",
      );
      assertEquals(
        (calls[0][1] as { headers?: Record<string, unknown> }).headers,
        { "x-trace": "abc" },
      );
      assertEquals(harness.scopes.length, 1);
      assertStrictEquals(call(harness.channel, "ack")!.args[0], msg);
    });

    it("ignores a null message from the consume callback", async () => {
      const calls: unknown[][] = [];

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: unknown): void {
          calls.push([payload]);
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();
      harness.channel.consumeCallback!(null);
      await flush();

      assertEquals(calls, []);
      assertEquals(harness.scopes, []);
    });

    it("routes a throwing handler to the exception handler and nacks", async () => {
      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(): void {
          throw new Error("handler boom");
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({ payload: { x: 1 }, routingKey: "tasks" });
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(harness.exceptionCalls.length, 1);
      const host = harness.exceptionCalls[0].host;
      assertInstanceOf(host, AmqpHostArguments);
      assertEquals(host.switchToRpc().getData(), { x: 1 });
      assertEquals(host.switchToRpc().getPattern(), "tasks");
      assertEquals(call(harness.channel, "nack")!.args, [msg, false, false]);
      assertStrictEquals(call(harness.channel, "ack"), undefined);
    });

    it("replies to an rpc message on success before acking", async () => {
      @AmqpConsumer()
      class RpcConsumer {
        @Rpc({ queue: "math.add" })
        add(payload: { a: number; b: number }): number {
          return payload.a + payload.b;
        }
      }

      const harness = createHarness({
        consumers: [RpcConsumer],
        instances: new Map([[RpcConsumer, new RpcConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({
        payload: { a: 2, b: 3 },
        routingKey: "math.add",
        replyTo: "reply-q",
        correlationId: "corr-1",
      });
      harness.channel.consumeCallback!(msg);
      await flush();

      const reply = call(harness.channel, "sendToQueue")!;
      assertEquals(reply.args[0], "reply-q");
      assertEquals(
        JSON.parse(new TextDecoder().decode(reply.args[1] as Buffer)),
        5,
      );
      assertEquals(reply.args[2], { correlationId: "corr-1" });
      assertStrictEquals(call(harness.channel, "ack")!.args[0], msg);
    });

    it("replies with an err envelope to an rpc message on failure", async () => {
      @AmqpConsumer()
      class RpcConsumer {
        @Rpc({ queue: "math.add" })
        add(): number {
          throw new Error("compute failed");
        }
      }

      const harness = createHarness({
        consumers: [RpcConsumer],
        instances: new Map([[RpcConsumer, new RpcConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({
        payload: {},
        routingKey: "math.add",
        replyTo: "reply-q",
        correlationId: "corr-2",
      });
      harness.channel.consumeCallback!(msg);
      await flush();

      const reply = call(harness.channel, "sendToQueue")!;
      assertEquals(reply.args[0], "reply-q");
      const body = JSON.parse(
        new TextDecoder().decode(reply.args[1] as Buffer),
      );
      assertEquals(typeof body.err, "string");
      assertEquals(call(harness.channel, "nack")!.args, [msg, false, false]);
    });

    it("falls back to the exchange name as the pattern when routingKey is empty", async () => {
      @AmqpConsumer()
      class PubSubConsumer {
        @PubSub({ exchange: "logs" })
        onLog(): void {
          throw new Error("log boom");
        }
      }

      const harness = createHarness({
        consumers: [PubSubConsumer],
        instances: new Map([[PubSubConsumer, new PubSubConsumer()]]),
        channel: makeChannel("gen-fanout"),
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({
        payload: { line: "x" },
        routingKey: "",
        exchange: "logs",
      });
      harness.channel.consumeCallback!(msg);
      await flush();

      const host = harness.exceptionCalls[0].host;
      assertInstanceOf(host, AmqpHostArguments);
      assertEquals(host.switchToRpc().getPattern(), "logs");
      assertEquals(call(harness.channel, "nack")!.args, [msg, false, false]);
    });

    it("uses the injected serializer for decode and the rpc reply encode", async () => {
      const calls: unknown[][] = [];

      @AmqpConsumer()
      class RpcConsumer {
        @Rpc({ queue: "echo" })
        echo(payload: unknown): string {
          calls.push([payload]);

          return "reply-value";
        }
      }

      // A serializer with a recognizable, non-JSON-default framing.
      const serializer = {
        serialize: (value: unknown) =>
          Buffer.from(`enc:${JSON.stringify(value)}`),
        deserialize: (content: Uint8Array) =>
          JSON.parse(new TextDecoder().decode(content).replace(/^enc:/, "")),
      };

      const harness = createHarness({
        consumers: [RpcConsumer],
        instances: new Map([[RpcConsumer, new RpcConsumer()]]),
        serializer,
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = {
        content: Buffer.from(`enc:${JSON.stringify({ in: 1 })}`),
        fields: { routingKey: "echo", exchange: "" },
        properties: { replyTo: "reply-q", correlationId: "c1" },
      };
      harness.channel.consumeCallback!(msg);
      await flush();

      // Decoded with the custom serializer (strips the "enc:" prefix).
      assertEquals(calls[0][0], { in: 1 });

      // The reply is encoded with the same custom serializer.
      const reply = call(harness.channel, "sendToQueue")!;
      assertEquals(reply.args[0], "reply-q");
      assertEquals(
        new TextDecoder().decode(reply.args[1] as Buffer),
        `enc:${JSON.stringify("reply-value")}`,
      );
      assertStrictEquals(call(harness.channel, "ack")!.args[0], msg);
    });
  });

  describe("guards", () => {
    it("allows the handler when the global guard permits", async () => {
      const calls: unknown[][] = [];

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: unknown): void {
          calls.push([payload]);
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map<Type, unknown>([
          [WorkerConsumer, new WorkerConsumer()],
          [AllowGuard, new AllowGuard()],
        ]),
        options: { globalGuards: [AllowGuard] },
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({ payload: { x: 1 }, routingKey: "tasks" });
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(calls.length, 1);
      assertStrictEquals(call(harness.channel, "ack")!.args[0], msg);
    });

    it("blocks the handler with a ForbiddenException when the global guard denies", async () => {
      const calls: unknown[][] = [];

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: unknown): void {
          calls.push([payload]);
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map<Type, unknown>([
          [WorkerConsumer, new WorkerConsumer()],
          [DenyGuard, new DenyGuard()],
        ]),
        options: { globalGuards: [DenyGuard] },
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({ payload: { x: 1 }, routingKey: "tasks" });
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(calls, []);
      assertEquals(harness.exceptionCalls.length, 1);
      assertInstanceOf(harness.exceptionCalls[0].err, ForbiddenException);
      assertEquals(call(harness.channel, "nack")!.args, [msg, false, false]);
    });

    it("denying global guard blocks even when the method permits", async () => {
      const calls: unknown[][] = [];

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        @UseGuards(AllowGuard)
        run(payload: unknown): void {
          calls.push([payload]);
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map<Type, unknown>([
          [WorkerConsumer, new WorkerConsumer()],
          [AllowGuard, new AllowGuard()],
          [DenyGuard, new DenyGuard()],
        ]),
        options: { globalGuards: [DenyGuard] },
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({ payload: { x: 1 }, routingKey: "tasks" });
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(calls, []);
      assertInstanceOf(harness.exceptionCalls[0].err, ForbiddenException);
    });

    it("runs a controller-level guard", async () => {
      const calls: unknown[][] = [];

      @AmqpConsumer()
      @UseGuards(DenyGuard)
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: unknown): void {
          calls.push([payload]);
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map<Type, unknown>([
          [WorkerConsumer, new WorkerConsumer()],
          [DenyGuard, new DenyGuard()],
        ]),
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({ payload: { x: 1 }, routingKey: "tasks" });
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(calls, []);
      assertInstanceOf(harness.exceptionCalls[0].err, ForbiddenException);
    });

    it("runs a function guard (CanActivateFn) supplied as a global guard", async () => {
      const calls: unknown[][] = [];
      const seen: ExecutionContext[] = [];

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: unknown): void {
          calls.push([payload]);
        }
      }

      const denyFn = (ctx: ExecutionContext): boolean => {
        seen.push(ctx);

        return false;
      };

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        options: { globalGuards: [denyFn] },
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({ payload: { x: 1 }, routingKey: "tasks" });
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(calls, []);
      assertEquals(seen.length, 1);
      assertInstanceOf(harness.exceptionCalls[0].err, ForbiddenException);
    });

    it("runs an instance guard supplied directly as a global guard", async () => {
      const calls: unknown[][] = [];

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: unknown): void {
          calls.push([payload]);
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        options: { globalGuards: [new AllowGuard()] },
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({ payload: { ok: 1 }, routingKey: "tasks" });
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(calls, [[{ ok: 1 }]]);
      assertStrictEquals(call(harness.channel, "ack")!.args[0], msg);
    });
  });

  describe("teardown", () => {
    it("closes every tracked channel and empties the list", async () => {
      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(): void {}
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();
      await harness.explorer.onBeforeApplicationShutdown();

      assertEquals(
        harness.channel.calls.filter((c) => c.method === "close").length,
        1,
      );

      // A second shutdown is a no-op (no further close calls).
      await harness.explorer.onBeforeApplicationShutdown();
      assertEquals(
        harness.channel.calls.filter((c) => c.method === "close").length,
        1,
      );
    });

    it("logs and does not throw when a tracked channel.close() rejects", async () => {
      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(): void {}
      }

      const channel = makeChannel();
      channel.close = () => Promise.reject(new Error("close failed"));

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        channel,
      });

      await harness.explorer.onApplicationBootstrap();
      await harness.explorer.onBeforeApplicationShutdown();

      // A second shutdown after the failure is still a no-op.
      await harness.explorer.onBeforeApplicationShutdown();
    });

    it("logs an unhandled dispatch error when the payload is invalid JSON", async () => {
      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(): void {}
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = {
        content: Buffer.from("not-json"),
        fields: { routingKey: "tasks", exchange: "" },
        properties: {},
      };
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(harness.loggerErrors.length, 1);
      assertEquals(
        harness.loggerErrors[0][0],
        "Unhandled error in AMQP message handler",
      );
      assertStrictEquals(call(harness.channel, "ack"), undefined);
      assertStrictEquals(call(harness.channel, "nack"), undefined);
    });
  });
});
