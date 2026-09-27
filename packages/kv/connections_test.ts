import type { Kv } from "@deno/kv";
import type { ExceptionHandler } from "@denorid/core";
import { RpcHostArguments } from "@denorid/core";
import { Test } from "@denorid/core/testing";
import { Injectable } from "@denorid/injector";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { describe, it } from "node:test";
import type { ConnectionEntry } from "./_connections.ts";
import {
  ConnectionNotEstablishedException,
  ConnectionNotFoundException,
} from "./exceptions.ts";
import { InjectKv, KvConnections } from "./connections.ts";

const UNREACHABLE_PATH = "/denorid-kv-missing-directory/store.db";

function createKv(close: () => void = () => {}): Kv {
  return { close } as unknown as Kv;
}

function createService(
  connections: Map<string, ConnectionEntry>,
  handled: unknown[] = [],
): KvConnections {
  const service = Object.create(KvConnections.prototype) as KvConnections;

  Object.defineProperty(service, "connections", { value: connections });
  Object.defineProperty(service, "exceptionHandler", {
    value: {
      handle: (err: unknown, host: unknown) => handled.push([err, host]),
    } as unknown as ExceptionHandler,
  });

  return service;
}

describe(KvConnections.name, () => {
  it("gets the default and named established connections", () => {
    const defaultKv = createKv();
    const namedKv = createKv();
    const service = createService(
      new Map([
        ["default", { path: "/tmp/default.db", kv: defaultKv }],
        ["named", { path: "/tmp/named.db", kv: namedKv }],
      ]),
    );

    assertStrictEquals(service.get(), defaultKv);
    assertStrictEquals(service.get("named"), namedKv);
  });

  it("throws when a connection name is unknown", () => {
    const service = createService(new Map());

    const error = assertThrows(
      () => service.get("missing"),
      ConnectionNotFoundException,
    );

    assertEquals(error.message, 'Failed to find "missing" connection.');
  });

  it("throws when a connection has not been established", () => {
    const service = createService(
      new Map([["default", { path: "/tmp/default.db" }]]),
    );

    const error = assertThrows(
      () => service.get(),
      ConnectionNotEstablishedException,
    );

    assertEquals(
      error.message,
      'The connection to "default" kv is not established yet.',
    );
  });

  it("opens missing connections and preserves existing kv instances", async () => {
    const handled: unknown[] = [];
    const existingKv = createKv();
    const entries = new Map<string, ConnectionEntry>([
      ["default", { path: ":memory:" }],
      ["existing", { path: UNREACHABLE_PATH, kv: existingKv }],
    ]);
    const service = createService(entries, handled);

    await service.connect();

    try {
      const opened = entries.get("default")?.kv;

      assertExists(opened);
      await opened.set(["key"], "value");
      assertEquals((await opened.get(["key"])).value, "value");
      assertStrictEquals(entries.get("existing")?.kv, existingKv);
      assertEquals(handled, []);
    } finally {
      service.close();
    }
  });

  it("delegates open errors to the exception handler and keeps opening the others", async () => {
    const handled: unknown[] = [];
    const entries = new Map<string, ConnectionEntry>([
      ["broken", { path: UNREACHABLE_PATH }],
      ["default", { path: ":memory:" }],
    ]);
    const service = createService(entries, handled);

    await service.connect();

    try {
      assertEquals(handled.length, 1);
      assertInstanceOf((handled[0] as unknown[])[0], Error);
      assertInstanceOf((handled[0] as unknown[])[1], RpcHostArguments);

      const rpc = ((handled[0] as unknown[])[1] as RpcHostArguments)
        .switchToRpc();

      assertEquals(rpc.getPattern(), "kv:connect");
      assertEquals(rpc.getData(), UNREACHABLE_PATH);
      assertEquals(entries.get("broken")?.kv, undefined);
      assertExists(entries.get("default")?.kv);
    } finally {
      service.close();
    }
  });

  it("closes established connections and deletes kv references", () => {
    const closed: string[] = [];
    const entries = new Map<string, ConnectionEntry>([
      ["default", {
        path: "/tmp/default.db",
        kv: createKv(() => closed.push("default")),
      }],
      ["missing", { path: "/tmp/missing.db" }],
    ]);
    const service = createService(entries);

    service.close();

    assertEquals(closed, ["default"]);
    assertEquals(entries.get("default")?.kv, undefined);
    assertEquals(entries.get("missing")?.kv, undefined);
  });

  it("delegates close errors to the exception handler", () => {
    const handled: unknown[] = [];
    const failure = new Error("close failed");
    const service = createService(
      new Map([
        ["default", {
          path: "/tmp/default.db",
          kv: createKv(() => {
            throw failure;
          }),
        }],
      ]),
      handled,
    );

    service.close();

    assertEquals(handled.length, 1);
    assertStrictEquals((handled[0] as unknown[])[0], failure);
    assertInstanceOf((handled[0] as unknown[])[1], RpcHostArguments);
    assertEquals(
      ((handled[0] as unknown[])[1] as RpcHostArguments).switchToRpc()
        .getPattern(),
      "kv:close",
    );
  });

  it("InjectKv resolves default and named kv instances through DI", async () => {
    const defaultKv = createKv();
    const namedKv = createKv();
    const fakeConnections = {
      get: (name?: string) => name === "named" ? namedKv : defaultKv,
    };

    @Injectable()
    class UsesDefaultKv {
      @InjectKv()
      kv!: Kv;
    }

    @Injectable()
    class UsesNamedKv {
      @InjectKv("named")
      kv!: Kv;
    }

    const module = await Test.createTestingModule({
      providers: [
        UsesDefaultKv,
        UsesNamedKv,
        { provide: KvConnections, useValue: fakeConnections },
      ],
    }).compile();

    try {
      assertStrictEquals((await module.get(UsesDefaultKv)).kv, defaultKv);
      assertStrictEquals((await module.get(UsesNamedKv)).kv, namedKv);
    } finally {
      await module.close();
    }
  });

  it("InjectKv propagates connection resolution failures", async () => {
    @Injectable()
    class UsesMissingKv {
      @InjectKv("missing")
      kv!: Kv;
    }

    const module = await Test.createTestingModule({
      providers: [
        UsesMissingKv,
        {
          provide: KvConnections,
          useValue: {
            get: () => {
              throw new ConnectionNotFoundException("missing");
            },
          },
        },
      ],
    }).compile();

    try {
      await assertRejects(async () => {
        await module.get(UsesMissingKv);
      }, ConnectionNotFoundException);
    } finally {
      await module.close();
    }
  });
});
