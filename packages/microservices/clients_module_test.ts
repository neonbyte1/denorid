import { Transport } from "@denorid/core/microservices";
import { InjectorContext, Module } from "@denorid/injector";
import { assertEquals, assertInstanceOf } from "@std/assert";
import { stub } from "@std/testing/mock";
import amqplib from "amqplib";
import { EventEmitter, once } from "node:events";
import net, { type AddressInfo, type Socket } from "node:net";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { mockStdWrite, type RestoreFn } from "./_test_utils.ts";
import { ClientsModule } from "./clients_module.ts";
import { RmqClient } from "./rmq/client.ts";
import { TcpClient } from "./tcp/client.ts";

interface Loopback {
  port: number;
  /** Resolves on the next accepted connection. */
  accepted: Promise<unknown>;
  close: () => Promise<void>;
}

async function startLoopback(): Promise<Loopback> {
  const sockets: Socket[] = [];
  const server = net.createServer((socket: Socket) => {
    sockets.push(socket);
  });
  const accepted = once(server, "connection");

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    port: (server.address() as AddressInfo).port,
    accepted,
    close: async () => {
      const closed = once(server, "close");

      for (const socket of sockets) {
        socket.destroy();
      }

      server.close();
      await closed;
    },
  };
}

/** A fake amqplib `ChannelModel` whose channel supports RmqClient's setup. */
function makeRmqConnection(): EventEmitter {
  const channel = Object.assign(new EventEmitter(), {
    assertQueue: (name: string) => Promise.resolve({ queue: name || "reply" }),
    consume: () => Promise.resolve({ consumerTag: "tag" }),
    sendToQueue: () => true,
    close: () => Promise.resolve(),
  });

  return Object.assign(new EventEmitter(), {
    createChannel: () => Promise.resolve(channel),
    close: () => Promise.resolve(),
  });
}

describe(ClientsModule.name, () => {
  let restoreStdout: RestoreFn;
  let restoreStderr: RestoreFn;

  before(() => {
    restoreStdout = mockStdWrite(process.stdout);
    restoreStderr = mockStdWrite(process.stderr);
  });

  after(() => {
    restoreStdout();
    restoreStderr();
  });

  describe("register()", () => {
    it("returns empty providers and exports for empty input", () => {
      const mod = ClientsModule.register([]);
      assertEquals((mod.providers as unknown[]).length, 0);
      assertEquals((mod.exports as unknown[]).length, 0);
      assertEquals(mod.module, ClientsModule);
    });

    it("exports all registered token names", () => {
      const mod = ClientsModule.register([
        { name: "A", transport: Transport.TCP },
        { name: "B", transport: Transport.TCP },
      ]);
      assertEquals((mod.exports as string[]).includes("A"), true);
      assertEquals((mod.exports as string[]).includes("B"), true);
    });

    it("creates and connects a TcpClient for TCP transport", async () => {
      const loopback = await startLoopback();

      @Module({
        imports: [
          ClientsModule.register([
            {
              name: "TCP_SVC",
              transport: Transport.TCP,
              options: { host: "127.0.0.1", port: loopback.port },
            },
          ]),
        ],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const client = await ctx.resolve("TCP_SVC");

      try {
        assertInstanceOf(client, TcpClient);
        await loopback.accepted;
      } finally {
        await (client as TcpClient).close();
        await loopback.close();
      }
    });

    it("creates a TcpClient with no options (defaults)", async () => {
      const loopback = await startLoopback();
      const realConnect = net.connect;
      using _s = stub(
        net,
        "connect",
        (() =>
          realConnect({ host: "127.0.0.1", port: loopback.port })) as never,
      );

      @Module({
        imports: [
          ClientsModule.register([{
            name: "TCP_DEF",
            transport: Transport.TCP,
          }]),
        ],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const client = await ctx.resolve("TCP_DEF");

      try {
        assertInstanceOf(client, TcpClient);
      } finally {
        await (client as TcpClient).close();
        await loopback.close();
      }
    });

    it("creates an RmqClient for RMQ transport", async () => {
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(makeRmqConnection() as never),
      );

      @Module({
        imports: [
          ClientsModule.register([
            {
              name: "RMQ_SVC",
              transport: Transport.RMQ,
              options: { queue: "test-queue" },
            },
          ]),
        ],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const client = await ctx.resolve("RMQ_SVC");
      assertInstanceOf(client, RmqClient);
    });

    it("creates an RmqClient with no options (defaults)", async () => {
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(makeRmqConnection() as never),
      );

      @Module({
        imports: [
          ClientsModule.register([{
            name: "RMQ_DEF",
            transport: Transport.RMQ,
          }]),
        ],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      assertInstanceOf(await ctx.resolve("RMQ_DEF"), RmqClient);
    });
  });
});
