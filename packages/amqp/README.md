<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  AMQP / RabbitMQ module for the <a href="https://github.com/neonbyte1/denorid">Denorid</a> framework.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/amqp">
    <img src="https://jsr.io/badges/@denorid/amqp" alt="Denorid amqp version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/amqp
```

This package talks to a broker through [`amqplib`](https://www.npmjs.com/package/amqplib) (v2) over Deno's `node:` compatibility layer. A running RabbitMQ broker is required at runtime.

## Overview

`@denorid/amqp` covers the five canonical RabbitMQ messaging patterns with a
decorator-driven consumer runtime and matching sender clients:

| Pattern | Consumer decorator | Sender client | Exchange |
|---|---|---|---|
| Work queue | `@Worker` | `WorkerClient` | default (direct) |
| Publish/Subscribe | `@PubSub` | `PublisherClient` | `fanout` |
| Routing | `@Routing` | `RoutingClient` | `direct` |
| Topic | `@Topic` | `TopicClient` | `topic` |
| RPC (request/reply) | `@Rpc` | `RpcClient` | default (direct) |

The module owns a single shared `AmqpConnection`, asserts each handler's
topology on bootstrap, dispatches messages with guard + `ExceptionHandler`
integration, and tears everything down on shutdown.

## Quick Start

### Register the module

```ts
import { Module } from "@denorid/injector";
import { AmqpModule } from "@denorid/amqp";

@Module({
  imports: [
    AmqpModule.forRoot({ url: "amqp://localhost" }),
  ],
})
export class AppModule {}
```

### Consume messages

Mark a class with `@AmqpConsumer()` and its methods with one of the five
pattern decorators. Each handler is invoked as `(payload, properties)` where
`payload` is the decoded body and `properties` is the raw amqplib
`MessageProperties` (`headers`, `correlationId`, `replyTo`, `contentType`, ...).

```ts
import { AmqpConsumer, PubSub, Rpc, Topic, Worker } from "@denorid/amqp";
import type { MessageProperties } from "amqplib";

@AmqpConsumer()
export class OrdersConsumer {
  // Work queue: round-robin delivery with fair dispatch (prefetch).
  @Worker({ queue: "orders", prefetch: 1 })
  process(payload: unknown): void {
    console.log("processing order", payload);
  }

  // Pub/Sub: broadcast to every bound queue.
  @PubSub({ exchange: "logs" })
  onLog(payload: unknown): void {
    console.log("log", payload);
  }

  // Topic: pattern routing keys (`*` single word, `#` zero or more).
  @Topic({ exchange: "metrics", routingKeys: ["cpu.*", "mem.#"] })
  onMetric(payload: unknown, properties: MessageProperties): void {
    console.log("metric", properties.headers, payload);
  }

  // RPC: the return value is published back to `replyTo`, correlated by id.
  @Rpc({ queue: "math.add" })
  add(payload: { a: number; b: number }): number {
    return payload.a + payload.b;
  }
}

@Module({
  imports: [AmqpModule.forRoot()],
  providers: [OrdersConsumer],
})
export class AppModule {}
```

> The `@AmqpConsumer()` class marker is required - it registers the class as a
> singleton provider and tags it for discovery. A pattern decorator alone does
> not register the class.

### Send messages

Clients are instantiated directly with the shared `AmqpConnection`. Each owns a
lazily-created channel that asserts its topology once on first send.

```ts
import { Inject, Injectable } from "@denorid/injector";
import {
  AmqpConnection,
  PublisherClient,
  RpcClient,
  TopicClient,
  WorkerClient,
} from "@denorid/amqp";

@Injectable()
export class OrderProducer {
  private readonly worker: WorkerClient;
  private readonly publisher: PublisherClient;
  private readonly topic: TopicClient;
  private readonly rpc: RpcClient;

  public constructor(
    @Inject(AmqpConnection) connection: AmqpConnection,
  ) {
    this.worker = new WorkerClient(connection, { queue: "orders" });
    this.publisher = new PublisherClient(connection, { exchange: "logs" });
    this.topic = new TopicClient(connection, { exchange: "metrics" });
    this.rpc = new RpcClient(connection, { queue: "math.add", timeout: 5_000 });
  }

  async run(): Promise<void> {
    await this.worker.send({ id: 1 });
    await this.publisher.publish({ level: "info", msg: "started" });
    await this.topic.publish("cpu.load", { value: 0.42 });

    const sum = await this.rpc.request<number>({ a: 2, b: 3 }); // 5
    console.log(sum);
  }
}
```

`RoutingClient` and `TopicClient` take a routing key per publish
(`publish(routingKey, data)`); `WorkerClient` and `PublisherClient` take only
the payload.

### Register clients declaratively

Instead of constructing clients by hand, declare them with `clients` on the
module options. Each entry is provided under its `name` token (built from the
shared `AmqpConnection`) and automatically exported, so it can be injected
anywhere. The `type` selects the client class (`worker`, `pub-sub`, `routing`,
`topic`, `rpc`); the remaining fields are that client's options.

```ts
import { Inject, Injectable } from "@denorid/injector";
import { AmqpModule, type WorkerClient } from "@denorid/amqp";

export const ORDERS_CLIENT = Symbol("ORDERS_CLIENT");

@Module({
  imports: [
    AmqpModule.forRoot({
      clients: [
        { name: ORDERS_CLIENT, type: "worker", queue: "orders" },
        { name: "LOGS_CLIENT", type: "pub-sub", exchange: "logs" },
        { name: "MATH_CLIENT", type: "rpc", queue: "math.add", timeout: 5_000 },
      ],
    }),
  ],
  providers: [OrderProducer],
})
export class AppModule {}

@Injectable()
export class OrderProducer {
  public constructor(
    @Inject(ORDERS_CLIENT) private readonly orders: WorkerClient,
  ) {}

  run(): Promise<void> {
    return this.orders.send({ id: 1 });
  }
}
```

`clients` is honored by both `forRoot` and `forRootAsync` (the registrations are
static metadata, independent of the async options factory).

## Guards

Handlers honor `@UseGuards()` from `@denorid/core` on the class and the method,
plus app-wide guards via `AmqpModuleOptions.globalGuards`. Per message the order
is **global -> controller -> method**; the first guard to return `false` throws
`ForbiddenException`, which is routed to the framework `ExceptionHandler` and the
message is `nack`ed (no requeue).

```ts
import { UseGuards } from "@denorid/core";

@AmqpConsumer()
@UseGuards(TenantGuard)
export class OrdersConsumer {
  @Worker({ queue: "orders" })
  @UseGuards(RateLimitGuard)
  process(payload: unknown): void {}
}

AmqpModule.forRoot({ globalGuards: [AuthGuard] });
```

`@UseGuards` is imported from `@denorid/core` - this package does not re-export
it.

## Custom serialization

Payloads are JSON-encoded by default (with `Uint8Array` passthrough). Override
the serializer by implementing `AmqpSerializer`. The `serializer` option accepts
either an instance or a class; a class is resolved through DI and MUST also be
registered in `extraProviders` so the container can build it (with its own
injected dependencies).

```ts
import { Inject, Injectable } from "@denorid/injector";
import type { AmqpSerializer } from "@denorid/amqp";
import { Buffer } from "node:buffer";

// Option A - an instance:
class MsgpackSerializer implements AmqpSerializer {
  serialize(value: unknown): Buffer {
    return Buffer.from(encode(value));
  }
  deserialize(content: Uint8Array): unknown {
    return decode(content);
  }
}

AmqpModule.forRoot({ serializer: new MsgpackSerializer() });

// Option B - a class resolved through DI (with its own injected dependencies).
// The class goes in `extraProviders`; `serializer` aliases AMQP_SERIALIZER to it.
@Injectable()
class TenantSerializer implements AmqpSerializer {
  @Inject(TENANT_CONFIG)
  private readonly config!: TenantConfig;

  serialize(value: unknown): Buffer {
    return Buffer.from(JSON.stringify({ tenant: this.config.id, value }));
  }
  deserialize(content: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(content)).value;
  }
}

AmqpModule.forRoot({
  serializer: TenantSerializer,
  extraProviders: [TenantSerializer],
});

// Equivalent low-level form - register the AMQP_SERIALIZER token directly:
import { AMQP_SERIALIZER } from "@denorid/amqp";

AmqpModule.forRoot({
  extraProviders: [{ provide: AMQP_SERIALIZER, useClass: MsgpackSerializer }],
});
```

The serializer is shared by the explorer and every client through the
`AmqpConnection`.

## Async configuration

```ts
AmqpModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    url: config.get("AMQP_URL"),
  }),
});
```

## Teardown

The shared connection is closed on module destruction, which cascades to every
consumer and client channel created from it. The explorer also closes its
consumer channels on graceful shutdown, and `RpcClient` rejects all in-flight
requests and clears their timers. Manually-instantiated (non-DI) clients do not
receive the shutdown hook, but their channels are still torn down when the shared
connection closes.

## License

The [@denorid/amqp](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
