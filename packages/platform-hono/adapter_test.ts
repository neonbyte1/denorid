import type { ExceptionHandler, RequestContext } from "@denorid/core";
import type { InjectorContext } from "@denorid/injector";
import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { describe, it } from "node:test";
import { HonoAdapter, type HonoAdapterOptions } from "./adapter.ts";

describe(HonoAdapter.name, () => {
  function getFreePorts(count: number): number[] {
    const listeners = Array.from(
      { length: count },
      () => Deno.listen({ hostname: "0.0.0.0", port: 0 }),
    );
    const ports = listeners.map((listener) => listener.addr.port);

    listeners.forEach((listener) => listener.close());

    return ports;
  }

  /**
   * Adapter with one controller mapped through `createControllerMapping`,
   * answering `GET /client/ip` with the resolved client IP.
   */
  async function createAdapter(
    options?: HonoAdapterOptions,
  ): Promise<HonoAdapter> {
    class ClientController {}

    Object.defineProperty(ClientController, Symbol.metadata, {
      value: {
        [Symbol.for("denorid.controller")]: { path: "/client" },
        [Symbol.for("denorid.request_mapping")]: [{ name: "ip", path: "ip" }],
      },
    });

    const controller = { ip: (ctx: RequestContext): string => ctx.ip };
    const adapter = new HonoAdapter(options);
    const mapping = await adapter.createControllerMapping({
      ctx: {
        container: { getTokensByTag: () => [ClientController] },
        runInRequestScopeAsync: (_id: string, fn: () => Promise<unknown>) =>
          fn(),
        clearContext: () => {},
        getHostModuleRef: () => ({ get: () => Promise.resolve(controller) }),
      } as unknown as InjectorContext,
      exceptionHandler: {} as ExceptionHandler,
      globalGuards: [],
      cors: undefined,
    });

    await mapping.register();

    return adapter;
  }

  async function getIp(port: number, headers?: HeadersInit): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${port}/client/ip`, {
      headers,
    });

    return await response.text();
  }

  function fakeServer(shutdown: () => Promise<void>): Deno.HttpServer {
    return { shutdown } as unknown as Deno.HttpServer;
  }

  describe("listen()", () => {
    it("serves the app on the given port", async () => {
      const [port] = getFreePorts(1);
      const adapter = await createAdapter();

      adapter.listen(port);

      try {
        assertEquals(await getIp(port), "127.0.0.1");
      } finally {
        await adapter.close();
      }
    });

    it("keeps the running server when called again", async () => {
      const [first, second] = getFreePorts(2);
      const adapter = await createAdapter();

      adapter.listen(first);
      adapter.listen(second);

      try {
        assertEquals(await getIp(first), "127.0.0.1");
        await assertRejects(() => getIp(second), TypeError);
      } finally {
        await adapter.close();
      }
    });

    it("defaults to port 3000", async () => {
      using serve = stub(
        Deno,
        "serve",
        (() => fakeServer(() => Promise.resolve())) as never,
      );
      const adapter = new HonoAdapter();

      adapter.listen();
      await adapter.close();

      assertSpyCalls(serve, 1);
      assertEquals<unknown>(serve.calls[0].args[0], { port: 3000 });
    });
  });

  describe("close()", () => {
    it("stops serving and lets a later listen() start again", async () => {
      const [port] = getFreePorts(1);
      const adapter = await createAdapter();

      adapter.listen(port);
      assertEquals(await getIp(port), "127.0.0.1");

      await adapter.close();
      await assertRejects(() => getIp(port), TypeError);

      adapter.listen(port);

      try {
        assertEquals(await getIp(port), "127.0.0.1");
      } finally {
        await adapter.close();
      }
    });

    it("resolves when the adapter never listened", async () => {
      await new HonoAdapter().close();
    });

    it("forgets the server even when shutting it down fails", async () => {
      using serve = stub(
        Deno,
        "serve",
        (() =>
          fakeServer(() =>
            Promise.reject(new Error("shutdown failed"))
          )) as never,
      );
      const adapter = new HonoAdapter();

      adapter.listen(8080);
      await assertRejects(() => adapter.close(), Error, "shutdown failed");

      adapter.listen(8080);

      assertSpyCalls(serve, 2);
      await assertRejects(() => adapter.close(), Error, "shutdown failed");
    });
  });

  describe("options", () => {
    it("resolves forwarded client addresses from trusted proxies", async () => {
      const [port] = getFreePorts(1);
      const adapter = await createAdapter({
        clientIp: { trustProxy: ["loopback"] },
      });

      adapter.listen(port);

      try {
        assertEquals(
          await getIp(port, { "x-forwarded-for": "6.6.6.6, 203.0.113.9" }),
          "203.0.113.9",
        );
      } finally {
        await adapter.close();
      }
    });
  });
});
