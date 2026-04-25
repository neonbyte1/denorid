import {
  type ClientProxy,
  DenoridFactory,
  EventPattern,
  MessageController,
  MessagePattern,
  Transport,
} from "@denorid/core";
import { Module } from "@denorid/injector";
import { ClientsModule } from "./clients_module.ts";
import { RmqServer } from "./rmq/server.ts";
import { TcpServer } from "./tcp/server.ts";

@MessageController()
class EchoController {
  @MessagePattern("echo")
  echo(data: unknown): unknown {
    return data;
  }

  @EventPattern({ foo: false })
  test(data: unknown): void {
    console.log("RECEIVED", data);
  }
}

const _RMQ_URL = {
  hostname: "127.0.0.1",
  username: "dev",
  password: "dev",
  port: 5672,
};

@Module({
  imports: [
    ClientsModule.register([{
      name: "default",
      //transport: Transport.RMQ,
      //options: { url: RMQ_URL, queue: "denorid" },
      transport: Transport.TCP,
      options: { port: 3000 },
    }]),
  ],
  providers: [EchoController],
})
class AppModule {}

RmqServer;

const app = await DenoridFactory.create(
  AppModule,
  //new RmqServer({ url: RMQ_URL, queue: "denorid" }),
  new TcpServer({ port: 3000 }),
);

app.listen();
await new Promise<void>((r) => setTimeout(r, 100));

const client = await app.get<ClientProxy>("default", { strict: false });
const reply = await client.send<unknown>("echo", { message: "hello" });

console.log("echo reply:", reply);

await client.emit({ foo: false }, new Uint8Array([1, 2, 3, 4]));

await new Promise<void>((r) => setTimeout(r, 200));

await app.close();
