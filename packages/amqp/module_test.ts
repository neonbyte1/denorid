import { Test } from "@denorid/core/testing";
import type {
  BaseProvider,
  ExistingProvider,
  FactoryProvider,
  ModuleRef,
  Provider,
  Type,
  ValueProvider,
} from "@denorid/injector";
import { Inject, Injectable } from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { spy } from "@std/testing/mock";
import { Buffer } from "node:buffer";
import { AMQP_MODULE_OPTIONS, AMQP_SERIALIZER } from "./_constants.ts";
import {
  PublisherClient,
  RoutingClient,
  RpcClient,
  TopicClient,
  WorkerClient,
} from "./clients.ts";
import { AmqpConnection } from "./connection.ts";
import { AmqpModule } from "./module.ts";
import type { AmqpClientRegistration } from "./options.ts";
import { type AmqpSerializer, JsonAmqpSerializer } from "./serialization.ts";

describe(AmqpModule.name, () => {
  describe("forRoot", () => {
    it("registers a value provider for options and propagates url and global", () => {
      const options = { url: "amqp://broker:5672", global: true };
      const mod = AmqpModule.forRoot(options);

      assertEquals(mod.module, AmqpModule);
      assertEquals(mod.global, true);
      assertEquals(mod.imports, []);

      const provider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === AMQP_MODULE_OPTIONS,
      ) as ValueProvider;

      assertStrictEquals(provider.useValue, options);
      assertEquals(
        (provider.useValue as { url: string }).url,
        "amqp://broker:5672",
      );
    });

    it("defaults to an empty options object when none is provided", () => {
      const mod = AmqpModule.forRoot();

      assertEquals(mod.global, undefined);

      const provider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === AMQP_MODULE_OPTIONS,
      ) as ValueProvider;

      assertEquals(provider.useValue, {});
    });
  });

  describe("forRootAsync", () => {
    it("registers a factory provider carrying useFactory, inject, and imports", () => {
      const TOKEN = Symbol("TOKEN");
      const fakeImport = class {} as Type;
      const useFactory = () => ({ url: "amqp://from-factory" });
      const mod = AmqpModule.forRootAsync({
        global: true,
        imports: [fakeImport],
        inject: [TOKEN],
        useFactory,
      });

      assertEquals(mod.global, true);
      assertEquals(mod.imports, [fakeImport]);

      const provider = mod.providers!.find(
        (p) => (p as BaseProvider).provide === AMQP_MODULE_OPTIONS,
      ) as FactoryProvider;

      assertStrictEquals(provider.useFactory, useFactory);
      assertEquals(provider.inject, [TOKEN]);
    });

    it("defaults imports to an empty array", () => {
      const mod = AmqpModule.forRootAsync({ useFactory: () => ({}) });

      assertEquals(mod.imports, []);
    });
  });

  describe("serializer provider", () => {
    function serializerProvider(
      providers: Provider[],
    ): ExistingProvider & FactoryProvider {
      return providers.find(
        (p) => (p as BaseProvider).provide === AMQP_SERIALIZER,
      ) as ExistingProvider & FactoryProvider;
    }

    it("registers a factory that defaults to JsonAmqpSerializer", () => {
      const mod = AmqpModule.forRoot();
      const provider = serializerProvider(mod.providers!);

      assertEquals(provider.inject, [AMQP_MODULE_OPTIONS]);
      assertInstanceOf(
        provider.useFactory({}) as AmqpSerializer,
        JsonAmqpSerializer,
      );
    });

    it("uses the serializer instance supplied in options", () => {
      const custom: AmqpSerializer = {
        serialize: () => Buffer.from(""),
        deserialize: () => null,
      };
      const mod = AmqpModule.forRoot({ serializer: custom });
      const provider = serializerProvider(mod.providers!);

      assertStrictEquals(provider.useFactory({ serializer: custom }), custom);
    });

    it("aliases the token to a class serializer via useExisting", () => {
      class CustomSerializer implements AmqpSerializer {
        serialize(): Buffer {
          return Buffer.from("");
        }
        deserialize(): unknown {
          return null;
        }
      }

      const mod = AmqpModule.forRoot({
        serializer: CustomSerializer,
        extraProviders: [CustomSerializer],
      });
      const provider = serializerProvider(mod.providers!);

      assertStrictEquals(provider.useExisting, CustomSerializer);
    });

    it("throws when a class serializer reaches the async factory", () => {
      class CustomSerializer implements AmqpSerializer {
        serialize(): Buffer {
          return Buffer.from("");
        }
        deserialize(): unknown {
          return null;
        }
      }

      // forRootAsync cannot know the serializer statically, so the factory
      // guards against a class arriving without an extraProviders override.
      const mod = AmqpModule.forRootAsync({ useFactory: () => ({}) });
      const provider = serializerProvider(mod.providers!);

      assertThrows(
        () => provider.useFactory({ serializer: CustomSerializer }),
        Error,
        "must be registered",
      );
    });

    it("appends extraProviders after the default serializer provider", () => {
      const override: Provider = {
        provide: AMQP_SERIALIZER,
        useClass: JsonAmqpSerializer,
      };
      const mod = AmqpModule.forRoot({ extraProviders: [override] });
      const tokens = mod.providers!.map((p) => (p as BaseProvider).provide);

      // The override is last, so the container's last-wins resolution picks it.
      assertStrictEquals(mod.providers!.at(-1), override);
      assertEquals(
        tokens.filter((t) => t === AMQP_SERIALIZER).length,
        2,
      );
    });

    it("flows extraProviders through forRootAsync", () => {
      const extra: Provider = { provide: "EXTRA", useValue: 1 };
      const mod = AmqpModule.forRootAsync({
        useFactory: () => ({}),
        extraProviders: [extra],
      });

      assertEquals(mod.providers!.includes(extra), true);
    });
  });

  describe("client providers", () => {
    const fakeConnection = {} as AmqpConnection;

    function clientProvider(
      mod: { providers?: Provider[] },
      name: string | symbol,
    ): FactoryProvider {
      return mod.providers!.find(
        (p) => (p as BaseProvider).provide === name,
      ) as FactoryProvider;
    }

    it("registers no client providers and empty exports by default", () => {
      const mod = AmqpModule.forRoot();

      assertEquals(mod.exports, []);
    });

    it("provides and exports each registered client under its name token", () => {
      const registrations: AmqpClientRegistration[] = [
        { name: "WORKER", type: "worker", queue: "tasks" },
        { name: "PUBSUB", type: "pub-sub", exchange: "events" },
        { name: "ROUTING", type: "routing", exchange: "logs" },
        { name: "TOPIC", type: "topic", exchange: "metrics" },
        { name: "RPC", type: "rpc", queue: "rpc" },
      ];
      const mod = AmqpModule.forRoot({ clients: registrations });

      assertEquals(mod.exports, [
        "WORKER",
        "PUBSUB",
        "ROUTING",
        "TOPIC",
        "RPC",
      ]);

      const cases: [string, new (...args: never[]) => unknown][] = [
        ["WORKER", WorkerClient],
        ["PUBSUB", PublisherClient],
        ["ROUTING", RoutingClient],
        ["TOPIC", TopicClient],
        ["RPC", RpcClient],
      ];

      for (const [name, ctor] of cases) {
        const provider = clientProvider(mod, name);

        assertEquals(provider.inject, [AmqpConnection]);
        assertInstanceOf(provider.useFactory(fakeConnection), ctor);
      }
    });

    it("registers client providers via forRootAsync", () => {
      const mod = AmqpModule.forRootAsync({
        useFactory: () => ({}),
        clients: [{ name: "W", type: "worker", queue: "q" }],
      });

      assertEquals(mod.exports, ["W"]);
      assertInstanceOf(
        clientProvider(mod, "W").useFactory(fakeConnection),
        WorkerClient,
      );
    });

    it("resolves a registered client through DI built from the connection", async () => {
      const CLIENT = Symbol("CLIENT");
      const module = await Test.createTestingModule({
        imports: [
          AmqpModule.forRoot({
            clients: [{ name: CLIENT, type: "worker", queue: "tasks" }],
          }),
        ],
      })
        .useCoreGlobals()
        .compile();

      try {
        assertInstanceOf(await module.get(CLIENT), WorkerClient);
      } finally {
        await module.close();
      }
    });
  });

  describe("lifecycle", () => {
    it("onModuleInit eager-resolves the connection", async () => {
      const connection = { close: () => Promise.resolve() };
      const resolved: unknown[] = [];
      const moduleRef = {
        get: (token: unknown) => {
          resolved.push(token);

          return Promise.resolve(connection);
        },
      } as unknown as ModuleRef;

      const module = new AmqpModule(moduleRef);
      await module.onModuleInit();

      assertEquals(resolved, [AmqpConnection]);
    });

    it("onModuleDestroy closes the connection exactly once", async () => {
      const connection = new AmqpConnection();
      const closeSpy = spy(connection, "close");
      const moduleRef = {
        get: () => Promise.resolve(connection),
      } as unknown as ModuleRef;

      const module = new AmqpModule(moduleRef);
      await module.onModuleDestroy();

      assertEquals(closeSpy.calls.length, 1);
    });
  });

  describe("end-to-end serializer resolution", () => {
    it("builds a class serializer through DI (with injected deps) reachable via the connection", async () => {
      const PREFIX = Symbol("PREFIX");

      @Injectable()
      class PrefixedSerializer implements AmqpSerializer {
        @Inject(PREFIX)
        private readonly prefix!: string;

        serialize(value: unknown): Buffer {
          return Buffer.from(`${this.prefix}${JSON.stringify(value)}`);
        }
        deserialize(content: Uint8Array): unknown {
          return JSON.parse(
            new TextDecoder().decode(content).slice(this.prefix.length),
          );
        }
      }

      const module = await Test.createTestingModule({
        imports: [
          AmqpModule.forRoot({
            serializer: PrefixedSerializer,
            extraProviders: [
              { provide: PREFIX, useValue: "p:" },
              PrefixedSerializer,
            ],
          }),
        ],
      })
        .useCoreGlobals()
        .compile();

      try {
        const connection = await module.get(AmqpConnection);

        assertInstanceOf(connection.serializer, PrefixedSerializer);
        // The injected PREFIX dependency was resolved through DI.
        assertEquals(
          new TextDecoder().decode(connection.serializer.serialize({ a: 1 })),
          'p:{"a":1}',
        );
      } finally {
        await module.close();
      }
    });

    it("uses the default JSON serializer when none is configured", async () => {
      const module = await Test.createTestingModule({
        imports: [AmqpModule.forRoot()],
      })
        .useCoreGlobals()
        .compile();

      try {
        const connection = await module.get(AmqpConnection);

        assertInstanceOf(connection.serializer, JsonAmqpSerializer);
      } finally {
        await module.close();
      }
    });
  });
});
