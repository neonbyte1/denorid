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
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
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

class FakeChannel extends EventEmitter {
  public readonly calls: RecordedCall[] = [];
  public consumeCallback?: (msg: unknown) => void;

  public constructor(private readonly generatedQueue = "amq.gen-q") {
    super();
  }

  public assertQueue(queue: string, opts: unknown): Promise<{ queue: string }> {
    this.calls.push({ method: "assertQueue", args: [queue, opts] });

    return Promise.resolve({ queue: queue || this.generatedQueue });
  }

  public assertExchange(
    exchange: string,
    type: string,
    opts: unknown,
  ): Promise<unknown> {
    this.calls.push({ method: "assertExchange", args: [exchange, type, opts] });

    return Promise.resolve({ exchange });
  }

  public bindQueue(
    queue: string,
    source: string,
    key: string,
  ): Promise<unknown> {
    this.calls.push({ method: "bindQueue", args: [queue, source, key] });

    return Promise.resolve({});
  }

  public prefetch(count: number): Promise<unknown> {
    this.calls.push({ method: "prefetch", args: [count] });

    return Promise.resolve({});
  }

  public consume(
    queue: string,
    fn: (msg: unknown) => void,
    opts: unknown,
  ): Promise<{ consumerTag: string }> {
    this.calls.push({ method: "consume", args: [queue, opts] });
    this.consumeCallback = fn;

    return Promise.resolve({ consumerTag: "tag" });
  }

  public cancel(consumerTag: string): Promise<unknown> {
    this.calls.push({ method: "cancel", args: [consumerTag] });

    return Promise.resolve({});
  }

  public sendToQueue(queue: string, content: Buffer, opts?: unknown): boolean {
    this.calls.push({ method: "sendToQueue", args: [queue, content, opts] });

    return true;
  }

  public ack(msg: unknown): void {
    this.calls.push({ method: "ack", args: [msg] });
  }

  public nack(msg: unknown, allUpTo?: boolean, requeue?: boolean): void {
    this.calls.push({ method: "nack", args: [msg, allUpTo, requeue] });
  }

  public close(): Promise<void> {
    this.calls.push({ method: "close", args: [] });
    this.emit("close");

    return Promise.resolve();
  }
}

function makeChannel(generatedQueue = "amq.gen-q"): FakeChannel {
  return new FakeChannel(generatedQueue);
}

function makeMessage(opts: {
  payload?: unknown;
  content?: Buffer;
  routingKey?: string;
  exchange?: string;
  replyTo?: string;
  correlationId?: string;
  contentType?: string;
  headers?: Record<string, unknown>;
}): unknown {
  return {
    content: opts.content ?? Buffer.from(JSON.stringify(opts.payload ?? {})),
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
      contentType: opts.contentType,
      headers: opts.headers,
    },
  };
}

interface Harness {
  explorer: AmqpExplorer;
  channel: FakeChannel;
  exceptionCalls: { err: unknown; host: unknown }[];
  loggerErrors: unknown[][];
  loggerWarnings: unknown[][];
  scopes: string[];
  cleared: string[];
  channelsCreated: () => number;
}

function createHarness(opts: {
  consumers: Type[];
  instances: Map<Type, unknown>;
  channel?: FakeChannel;
  /** Channels (or connection failures) handed out by successive createChannel calls. */
  channels?: (FakeChannel | Error)[];
  options?: AmqpModuleOptions;
  serializer?: AmqpSerializer;
  handleException?: () => Promise<void>;
}): Harness {
  const pool = opts.channels ?? [opts.channel ?? makeChannel()];
  const channel = pool.find((c) => c instanceof FakeChannel)!;
  const exceptionCalls: { err: unknown; host: unknown }[] = [];
  const loggerErrors: unknown[][] = [];
  const loggerWarnings: unknown[][] = [];
  const scopes: string[] = [];
  const cleared: string[] = [];
  let created = 0;

  const connection = {
    createChannel: () => {
      const next = pool[Math.min(created++, pool.length - 1)];

      return next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve(next);
    },
  } as unknown as AmqpConnection;

  const ctx = {
    runInRequestScopeAsync: async <T>(
      contextId: string,
      fn: () => Promise<T>,
    ): Promise<T> => {
      scopes.push(contextId);

      return await fn();
    },
    clearContext: (contextId: string) => {
      cleared.push(contextId);
    },
  } as unknown as InjectorContext;

  const moduleRef = {
    getTokensByTag: (tag: unknown) =>
      tag === AMQP_CONSUMER ? opts.consumers : [],
    get: (token: unknown, options?: { strict?: boolean }) => {
      if (token === AmqpConnection) {
        return Promise.resolve(connection);
      }

      if (token === InjectorContext) {
        return Promise.resolve(ctx);
      }

      if (opts.instances.has(token as Type)) {
        // Consumers and guards live in the application's modules, outside the
        // explorer's own (AmqpModule) scope: only graph-wide lookups see them.
        return options?.strict === false
          ? Promise.resolve(opts.instances.get(token as Type))
          : Promise.reject(
            new Error(
              `Token "${
                String(token)
              }" is not available in this module's scope`,
            ),
          );
      }

      return Promise.reject(new Error(`Unexpected token: ${String(token)}`));
    },
  } as unknown as ModuleRef;

  const explorer = new AmqpExplorer(moduleRef);

  Object.defineProperty(explorer, "exceptionHandler", {
    value: {
      handle: (err: unknown, host: unknown) => {
        exceptionCalls.push({ err, host });

        return opts.handleException?.() ?? Promise.resolve();
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
      warn: (...args: unknown[]) => {
        loggerWarnings.push(args);
      },
    },
  });

  return {
    explorer,
    channel,
    exceptionCalls,
    loggerErrors,
    loggerWarnings,
    scopes,
    cleared,
    channelsCreated: () => created,
  };
}

function call(channel: FakeChannel, method: string): RecordedCall | undefined {
  return channel.calls.find((c) => c.method === method);
}

function methods(channel: FakeChannel): string[] {
  return channel.calls.map((c) => c.method);
}

function decode(content: unknown): unknown {
  return JSON.parse(new TextDecoder().decode(content as Buffer));
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

/** Captured before any `FakeTime` swaps the global out. */
const realSetTimeout = globalThis.setTimeout;

/** Lets every pending promise chain settle (one real macrotask). */
function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  realSetTimeout(resolve, 0);

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
      assertEquals(reply.args[2], {
        correlationId: "corr-1",
        contentType: "application/json",
      });
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
    it("cancels the consumer before closing its channel, once", async () => {
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

      assertEquals(call(harness.channel, "cancel")!.args, ["tag"]);
      assertEquals(
        methods(harness.channel).filter((m) => m === "cancel" || m === "close"),
        ["cancel", "close"],
      );

      // A second shutdown is a no-op (no further cancel or close calls).
      await harness.explorer.onBeforeApplicationShutdown();
      assertEquals(
        methods(harness.channel).filter((m) => m === "cancel" || m === "close"),
        ["cancel", "close"],
      );
    });

    it("waits for in-flight handlers so they still ack before the channel closes", async () => {
      const gate = Promise.withResolvers<void>();

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        async run(): Promise<void> {
          await gate.promise;
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();
      harness.channel.consumeCallback!(
        makeMessage({ payload: { x: 1 }, routingKey: "tasks" }),
      );
      await flush();

      const shutdown = harness.explorer.onBeforeApplicationShutdown();
      await flush();

      // Consumption stopped, but the channel stays open for the handler.
      assertEquals(methods(harness.channel).includes("cancel"), true);
      assertEquals(methods(harness.channel).includes("close"), false);

      gate.resolve();
      await shutdown;

      assertEquals(
        methods(harness.channel).filter((m) =>
          ["cancel", "ack", "close"].includes(m)
        ),
        ["cancel", "ack", "close"],
      );
      assertEquals(harness.exceptionCalls, []);
      assertEquals(harness.loggerErrors, []);
    });

    it("does not subscribe again when the channel closes while shutting down", async () => {
      const gate = Promise.withResolvers<void>();

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        async run(): Promise<void> {
          await gate.promise;
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        options: { reconnectDelay: 1 },
      });

      await harness.explorer.onApplicationBootstrap();
      harness.channel.consumeCallback!(
        makeMessage({ payload: {}, routingKey: "tasks" }),
      );
      await flush();

      const shutdown = harness.explorer.onBeforeApplicationShutdown();
      await flush();

      // The broker connection drops while the handler is still running.
      harness.channel.emit("close");
      gate.resolve();
      await shutdown;

      assertEquals(harness.channelsCreated(), 1);
      assertEquals(harness.loggerWarnings, []);
      assertEquals(methods(harness.channel).includes("close"), false);
    });

    it("does not throw when cancelling or closing a channel fails", async () => {
      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(): void {}
      }

      const channel = makeChannel();
      channel.cancel = () => Promise.reject(new Error("cancel failed"));
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
  });

  describe("message failures", () => {
    it("nacks a body that cannot be deserialized and routes the error to the exception handler", async () => {
      const calls: unknown[] = [];

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: unknown): void {
          calls.push(payload);
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({
        content: Buffer.from("not-json"),
        routingKey: "tasks",
      });
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(calls, []);
      assertEquals(harness.exceptionCalls.length, 1);
      assertInstanceOf(harness.exceptionCalls[0].err, SyntaxError);
      const host = harness.exceptionCalls[0].host;
      assertInstanceOf(host, AmqpHostArguments);
      assertEquals(host.switchToRpc().getPattern(), "tasks");
      assertEquals(host.switchToRpc().getData(), undefined);
      assertEquals(call(harness.channel, "nack")!.args, [msg, false, false]);
      assertStrictEquals(call(harness.channel, "ack"), undefined);
      assertEquals(harness.cleared, harness.scopes);
      assertEquals(harness.loggerErrors, []);
    });

    it("replies with an err envelope when an rpc body cannot be deserialized", async () => {
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

      const msg = makeMessage({
        content: Buffer.from("{broken"),
        routingKey: "math.add",
        replyTo: "reply-q",
        correlationId: "corr-3",
      });
      harness.channel.consumeCallback!(msg);
      await flush();

      const reply = call(harness.channel, "sendToQueue")!;
      assertEquals(reply.args[0], "reply-q");
      assertEquals(
        typeof (decode(reply.args[1]) as Record<string, unknown>).err,
        "string",
      );
      assertEquals(call(harness.channel, "nack")!.args, [msg, false, false]);
    });

    it("passes a body tagged application/octet-stream through as raw bytes", async () => {
      const calls: unknown[] = [];

      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: unknown): void {
          calls.push(payload);
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      const content = Buffer.from("raw-bytes");
      const msg = makeMessage({
        content,
        routingKey: "tasks",
        contentType: "application/octet-stream",
      });
      harness.channel.consumeCallback!(msg);
      await flush();

      assertStrictEquals(calls[0], content);
      assertStrictEquals(call(harness.channel, "ack")!.args[0], msg);
    });

    it("replies null to a void rpc handler and acks", async () => {
      const ran: boolean[] = [];

      @AmqpConsumer()
      class RpcConsumer {
        @Rpc({ queue: "jobs.run" })
        run(): void {
          ran.push(true);
        }
      }

      const harness = createHarness({
        consumers: [RpcConsumer],
        instances: new Map([[RpcConsumer, new RpcConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({
        routingKey: "jobs.run",
        replyTo: "reply-q",
        correlationId: "corr-4",
      });
      harness.channel.consumeCallback!(msg);
      await flush();

      assertEquals(ran, [true]);
      assertEquals(decode(call(harness.channel, "sendToQueue")!.args[1]), null);
      assertStrictEquals(call(harness.channel, "ack")!.args[0], msg);
      assertStrictEquals(call(harness.channel, "nack"), undefined);
      assertEquals(harness.exceptionCalls, []);
    });

    it("acks and replies an err envelope when the rpc result cannot be serialized", async () => {
      @AmqpConsumer()
      class RpcConsumer {
        @Rpc({ queue: "ids.next" })
        next(): bigint {
          return 1n;
        }
      }

      const harness = createHarness({
        consumers: [RpcConsumer],
        instances: new Map([[RpcConsumer, new RpcConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({
        routingKey: "ids.next",
        replyTo: "reply-q",
        correlationId: "corr-5",
      });
      harness.channel.consumeCallback!(msg);
      await flush();

      const reply = call(harness.channel, "sendToQueue")!;
      const body = decode(reply.args[1]) as { err: string };
      assertEquals(body.err.startsWith("Failed to serialize reply: "), true);
      assertEquals(reply.args[2], {
        correlationId: "corr-5",
        contentType: "application/json",
      });
      // The handler succeeded: the message is settled as processed.
      assertStrictEquals(call(harness.channel, "ack")!.args[0], msg);
      assertStrictEquals(call(harness.channel, "nack"), undefined);
      assertEquals(harness.exceptionCalls, []);
      assertEquals(
        harness.loggerErrors[0][0],
        "Failed to serialize the AMQP RPC reply",
      );
    });

    it("logs a reply that cannot be sent and still settles the message", async () => {
      @AmqpConsumer()
      class RpcConsumer {
        @Rpc({ queue: "math.add" })
        add(): number {
          return 1;
        }
      }

      const channel = makeChannel();
      channel.sendToQueue = () => {
        throw new Error("Channel closing");
      };

      const harness = createHarness({
        consumers: [RpcConsumer],
        instances: new Map([[RpcConsumer, new RpcConsumer()]]),
        channel,
      });

      await harness.explorer.onApplicationBootstrap();

      const msg = makeMessage({
        routingKey: "math.add",
        replyTo: "reply-q",
        correlationId: "corr-6",
      });
      channel.consumeCallback!(msg);
      await flush();

      assertEquals(
        harness.loggerErrors[0][0],
        "Failed to send the AMQP RPC reply",
      );
      assertStrictEquals(call(channel, "ack")!.args[0], msg);
      assertEquals(harness.exceptionCalls, []);
    });

    it("logs instead of throwing when the message cannot be acked", async () => {
      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(): void {}
      }

      const channel = makeChannel();
      channel.ack = () => {
        throw new Error("Channel closed");
      };

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        channel,
      });

      await harness.explorer.onApplicationBootstrap();
      channel.consumeCallback!(makeMessage({ routingKey: "tasks" }));
      await flush();

      assertEquals(harness.loggerErrors.length, 1);
      assertEquals(harness.loggerErrors[0][0], "Failed to ack an AMQP message");
      assertEquals(harness.exceptionCalls, []);
    });

    it("logs instead of throwing when the message cannot be nacked", async () => {
      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(): void {
          throw new Error("handler boom");
        }
      }

      const channel = makeChannel();
      channel.nack = () => {
        throw new Error("Channel closed");
      };

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        channel,
      });

      await harness.explorer.onApplicationBootstrap();
      channel.consumeCallback!(makeMessage({ routingKey: "tasks" }));
      await flush();

      assertEquals(harness.exceptionCalls.length, 1);
      assertEquals(harness.loggerErrors.length, 1);
      assertEquals(
        harness.loggerErrors[0][0],
        "Failed to nack an AMQP message",
      );
    });

    it("clears the per-message DI context after every message", async () => {
      @AmqpConsumer()
      class WorkerConsumer {
        @Worker({ queue: "tasks" })
        run(payload: { fail: boolean }): void {
          if (payload.fail) {
            throw new Error("handler boom");
          }
        }
      }

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
      });

      await harness.explorer.onApplicationBootstrap();
      harness.channel.consumeCallback!(
        makeMessage({ payload: { fail: false }, routingKey: "tasks" }),
      );
      harness.channel.consumeCallback!(
        makeMessage({ payload: { fail: true }, routingKey: "tasks" }),
      );
      await flush();

      assertEquals(harness.scopes.length, 2);
      assertEquals(harness.cleared, harness.scopes);
    });

    it("logs an error escaping the dispatch pipeline", async () => {
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
        handleException: () => Promise.reject(new Error("filter crashed")),
      });

      await harness.explorer.onApplicationBootstrap();
      harness.channel.consumeCallback!(makeMessage({ routingKey: "tasks" }));
      await flush();

      assertEquals(
        harness.loggerErrors[0][0],
        "Unhandled error in AMQP message handler",
      );
      assertEquals(harness.cleared, harness.scopes);
    });
  });

  describe("recovery", () => {
    @AmqpConsumer()
    class WorkerConsumer {
      public readonly calls: unknown[] = [];

      @Worker({ queue: "tasks" })
      run(payload: unknown): void {
        this.calls.push(payload);
      }
    }

    it("subscribes again on a new channel after the consumer channel closed unexpectedly", async () => {
      const first = makeChannel();
      const second = makeChannel();
      const consumer = new WorkerConsumer();
      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, consumer]]),
        channels: [first, second],
        options: { reconnectDelay: 1 },
      });

      using time = new FakeTime();

      await harness.explorer.onApplicationBootstrap();

      // Broker restart: amqplib closes every channel of the dropped connection.
      first.emit("close");
      await flush();

      assertEquals(harness.channelsCreated(), 1);

      await time.tickAsync(1);
      await flush();

      assertEquals(harness.loggerWarnings.length, 1);
      assertEquals(call(second, "assertQueue")!.args, ["tasks", {
        durable: true,
      }]);
      assertEquals(call(second, "consume")!.args, ["tasks", { noAck: false }]);

      const msg = makeMessage({ payload: { n: 1 }, routingKey: "tasks" });
      second.consumeCallback!(msg);
      await flush();

      assertEquals(consumer.calls, [{ n: 1 }]);
      assertStrictEquals(call(second, "ack")!.args[0], msg);

      await harness.explorer.onBeforeApplicationShutdown();

      assertEquals(methods(second).slice(-2), ["cancel", "close"]);
      assertEquals(methods(first).includes("cancel"), false);
    });

    it("keeps retrying while subscribing again fails", async () => {
      const first = makeChannel();
      const second = makeChannel();
      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        channels: [first, new Error("ECONNREFUSED"), second],
        options: { reconnectDelay: 1 },
      });

      using time = new FakeTime();

      await harness.explorer.onApplicationBootstrap();
      first.emit("close");
      await time.tickAsync(1);
      await flush();

      assertEquals(harness.channelsCreated(), 2);

      await time.tickAsync(1);
      await flush();

      assertEquals(
        harness.loggerErrors[0][0],
        "Failed to subscribe WorkerConsumer.run again",
      );
      assertEquals(harness.channelsCreated(), 3);
      assertEquals(call(second, "consume")!.args[0], "tasks");

      await harness.explorer.onBeforeApplicationShutdown();
    });

    it("waits one second before subscribing again by default", async () => {
      const first = makeChannel();
      const second = makeChannel();
      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        channels: [first, second],
      });
      using time = new FakeTime();

      await harness.explorer.onApplicationBootstrap();
      first.emit("close");
      await time.tickAsync(999);
      await flush();

      assertEquals(harness.channelsCreated(), 1);

      await time.tickAsync(1);
      await flush();

      assertEquals(harness.channelsCreated(), 2);
      await harness.explorer.onBeforeApplicationShutdown();
    });

    it("cancels a scheduled resubscribe on shutdown", async () => {
      const first = makeChannel();
      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        channels: [first, makeChannel()],
        options: { reconnectDelay: 60_000 },
      });

      using time = new FakeTime();

      await harness.explorer.onApplicationBootstrap();
      first.emit("close");
      await harness.explorer.onBeforeApplicationShutdown();
      await time.tickAsync(60_000);

      assertEquals(harness.channelsCreated(), 1);
    });

    it("waits for a resubscribe in progress and does not retry it after shutdown", async () => {
      const first = makeChannel();
      const second = makeChannel();
      const gate = Promise.withResolvers<void>();
      second.assertQueue = async () => {
        await gate.promise;

        throw new Error("Channel closed by server: 404");
      };
      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        channels: [first, second, makeChannel()],
        options: { reconnectDelay: 1 },
      });

      using time = new FakeTime();

      await harness.explorer.onApplicationBootstrap();
      first.emit("close");
      await time.tickAsync(1);
      await flush();

      const shutdown = harness.explorer.onBeforeApplicationShutdown();
      gate.resolve();
      await shutdown;
      await time.tickAsync(10);
      await flush();

      assertEquals(harness.channelsCreated(), 2);
      assertEquals(harness.loggerErrors.length, 1);
    });

    it("closes the channel and fails bootstrap when the topology cannot be asserted", async () => {
      const channel = makeChannel();
      channel.assertQueue = () =>
        Promise.reject(new Error("Channel closed by server: 406"));
      channel.close = () => {
        channel.calls.push({ method: "close", args: [] });

        return Promise.reject(new Error("Channel closed"));
      };

      const harness = createHarness({
        consumers: [WorkerConsumer],
        instances: new Map([[WorkerConsumer, new WorkerConsumer()]]),
        channel,
      });

      await assertRejects(
        () => harness.explorer.onApplicationBootstrap(),
        Error,
        "406",
      );
      assertEquals(methods(channel), ["close"]);
    });
  });
});
