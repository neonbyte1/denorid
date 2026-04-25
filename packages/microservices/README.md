<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  Microservices module for the <a href="https://github.com/neonbyte1/denorid">Denorid</a> framework.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/microservices">
    <img src="https://jsr.io/badges/@denorid/microservices" alt="Denorid microservices version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/microservices
```

## Quick Start

### TCP Transport

```ts
import {
  DenoridFactory,
  EventPattern,
  MessageController,
  MessagePattern,
} from "@denorid/core";
import { Module } from "@denorid/injector";
import { ClientsModule, TcpServer } from "@denorid/microservices";
import { Transport } from "@denorid/core/microservices";

@MessageController()
class MathController {
  @MessagePattern("add")
  add(data: { a: number; b: number }): number {
    return data.a + data.b;
  }

  @EventPattern("notify")
  notify(data: unknown): void {
    console.log("Notification:", data);
  }
}

@Module({
  imports: [
    ClientsModule.register([{
      name: "MATH_SERVICE",
      transport: Transport.TCP,
      options: { host: "localhost", port: 3000 },
    }]),
  ],
  providers: [MathController],
})
class AppModule {}

const app = await DenoridFactory.create(
  AppModule,
  new TcpServer({ port: 3000 }),
);

await app.listen();
```

### RabbitMQ Transport

```ts
import {
  DenoridFactory,
  MessageController,
  MessagePattern,
} from "@denorid/core";
import { Module } from "@denorid/injector";
import { ClientsModule, RmqServer } from "@denorid/microservices";
import { Transport } from "@denorid/core/microservices";

@MessageController()
class NotificationController {
  @MessagePattern("send")
  async send(data: { userId: string; message: string }) {
    console.log(`Sending to ${data.userId}: ${data.message}`);
    return { success: true };
  }
}

@Module({
  imports: [
    ClientsModule.register([{
      name: "NOTIFICATION_SERVICE",
      transport: Transport.RMQ,
      options: {
        url: {
          hostname: "127.0.0.1",
          username: "guest",
          password: "guest",
          port: 5672,
        },
        queue: "notifications",
      },
    }]),
  ],
  providers: [NotificationController],
})
class AppModule {}

const app = await DenoridFactory.create(
  AppModule,
  new RmqServer({ url: { hostname: "127.0.0.1", port: 5672 }, queue: "notifications" }),
);

await app.listen();
```

## License

The [@denorid/microservices](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
