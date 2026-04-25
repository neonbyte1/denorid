import { Transport } from "@denorid/core/microservices";
import { InjectorContext, Module } from "@denorid/injector";
import { assertEquals, assertInstanceOf } from "@std/assert";
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import amqplib from "amqplib";
import { mockStdWrite, type RestoreFn } from "./_test_utils.ts";
import { ClientsModule } from "./clients_module.ts";
import { RmqClient } from "./rmq/client.ts";
import { TcpClient } from "./tcp/client.ts";

describe(ClientsModule.name, () => {
  let restoreStdout: RestoreFn;
  let restoreStderr: RestoreFn;
  let tcpConn: Deno.TcpConn;
  let rmqConn: {
    createChannel(): Promise<unknown>;
    close(): Promise<void>;
    on(): void;
  };

  beforeAll(() => {
    restoreStdout = mockStdWrite(Deno.stdout);
    restoreStderr = mockStdWrite(Deno.stderr);
    tcpConn = {
      read: () => Promise.resolve(null),
      write: (buf: Uint8Array) => Promise.resolve(buf.byteLength),
      close: () => {},
    } as unknown as Deno.TcpConn;

    const ch = {
      assertQueue: (name: string) =>
        Promise.resolve({ queue: name || "reply" }),
      consume: async (_q: string, _fn: (msg: unknown) => void) => {},
      sendToQueue: () => true,
      close: () => Promise.resolve(),
    };

    rmqConn = {
      createChannel: () => Promise.resolve(ch),
      close: () => Promise.resolve(),
      on: () => {},
    };
  });

  afterAll(() => {
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

    it("creates a TcpClient for TCP transport", async () => {
      using _s = stub(
        Deno,
        "connect",
        (() => Promise.resolve(tcpConn)) as never,
      );

      @Module({
        imports: [
          ClientsModule.register([
            {
              name: "TCP_SVC",
              transport: Transport.TCP,
              options: { host: "127.0.0.1", port: 4001 },
            },
          ]),
        ],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const client = await ctx.resolve("TCP_SVC");
      assertInstanceOf(client, TcpClient);
    });

    it("creates a TcpClient with no options (defaults)", async () => {
      using _s = stub(
        Deno,
        "connect",
        (() => Promise.resolve(tcpConn)) as never,
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
      assertInstanceOf(await ctx.resolve("TCP_DEF"), TcpClient);
    });

    it("creates an RmqClient for RMQ transport", async () => {
      using _s = stub(
        amqplib,
        "connect",
        () => Promise.resolve(rmqConn as never),
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
        () => Promise.resolve(rmqConn as never),
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
