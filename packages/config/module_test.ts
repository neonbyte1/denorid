import { Test, type TestingModule } from "@denorid/core/testing";
import { Inject, Injectable, Module } from "@denorid/injector";
import { Logger } from "@denorid/logger";
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import { describe, it } from "node:test";
import { setEnv, stubFiles } from "./_test_fixtures.ts";
import { ConfigService } from "./config_service.ts";
import { ConfigModuleImportOrderError } from "./exceptions.ts";
import { ConfigModule } from "./module.ts";
import type { ConfigModuleOptions } from "./module_options.ts";

@Injectable()
class FeatureService {
  @Inject(ConfigService)
  public readonly config!: ConfigService;
}

@Module({
  imports: [ConfigModule],
  providers: [FeatureService],
  exports: [FeatureService],
})
class FeatureModule {}

@Injectable()
class GlobalConsumer {
  @Inject(ConfigService)
  public readonly config!: ConfigService;
}

@Module({ providers: [GlobalConsumer], exports: [GlobalConsumer] })
class GlobalConsumerModule {}

const APP_NAME = Symbol("APP_NAME");
const YAML_PATH = Symbol("YAML_PATH");

@Module({
  providers: [{ provide: APP_NAME, useValue: "from-provider" }],
  exports: [APP_NAME],
})
class AppNameModule {}

const rootOptions: ConfigModuleOptions = {
  envFilePath: [],
  ignoreEnvVars: true,
  load: [() => ({ name: "root" })],
};

async function withModule(
  imports: Parameters<typeof Test.createTestingModule>[0]["imports"],
  run: (module: TestingModule) => Promise<void>,
): Promise<void> {
  const module = await Test.createTestingModule({ imports }).compile();

  try {
    await run(module);
  } finally {
    await module.close();
  }
}

describe(ConfigModule.name, () => {
  it("loads the .env file and environment variables when imported as is", async () => {
    using _env = setEnv({ DENORID_CONFIG_MODULE_TEST: "runtime" });
    using _files = stubFiles({ ".env": "FROM_FILE=file" });

    await withModule([ConfigModule], async (module) => {
      const config = await module.get(ConfigService);

      assertEquals(config.get("FROM_FILE"), "file");
      assertEquals(config.get("DENORID_CONFIG_MODULE_TEST"), "runtime");
    });
  });

  describe("forRoot", () => {
    it("loads the configured sources", async () => {
      using _files = stubFiles({ "config.yaml": "database:\n  port: 5432" });

      await withModule([
        ConfigModule.forRoot({
          yamlFilePath: "config.yaml",
          envFilePath: [],
          ignoreEnvVars: true,
        }),
      ], async (module) => {
        const config = await module.get(ConfigService);

        assertEquals(config.get("database.port"), 5432);
      });
    });

    it("configures plain ConfigModule imports regardless of import order", async () => {
      using _files = stubFiles({});

      for (
        const imports of [
          [FeatureModule, ConfigModule.forRoot(rootOptions)],
          [ConfigModule.forRoot(rootOptions), FeatureModule],
        ]
      ) {
        await withModule(imports, async (module) => {
          const feature = await module.get(FeatureService);

          assertEquals(feature.config.get("name"), "root");
          assertStrictEquals(feature.config, await module.get(ConfigService));
        });
      }
    });

    it("shares one service loaded once when registered globally", async () => {
      using _files = stubFiles({});

      const factory = spy(() => ({ name: "global" }));

      await withModule([
        GlobalConsumerModule,
        ConfigModule.forRoot({
          global: true,
          envFilePath: [],
          ignoreEnvVars: true,
          load: [factory],
        }),
      ], async (module) => {
        const consumer = await module.get(GlobalConsumer);

        assertEquals(consumer.config.get("name"), "global");
        assertStrictEquals(consumer.config, await module.get(ConfigService));
        assertEquals(factory.calls.length, 1);
      });
    });

    it("loads the configuration once per application", async () => {
      using _files = stubFiles({});

      const dynamicModule = ConfigModule.forRoot({ envFilePath: [] });
      let first: ConfigService | undefined;

      {
        using _env = setEnv({ DENORID_CONFIG_MODULE_TEST: "first" });

        await withModule([dynamicModule], async (module) => {
          first = await module.get(ConfigService);
        });
      }

      using _env = setEnv({ DENORID_CONFIG_MODULE_TEST: "second" });

      await withModule([dynamicModule], async (module) => {
        const second = await module.get(ConfigService);

        assertNotStrictEquals(second, first);
        assertEquals(first?.get("DENORID_CONFIG_MODULE_TEST"), "first");
        assertEquals(second.get("DENORID_CONFIG_MODULE_TEST"), "second");
      });
    });

    it("rejects ConfigService resolution when validation fails", async () => {
      using _files = stubFiles({});
      using errorStub = stub(Logger.prototype, "error");

      await withModule([
        ConfigModule.forRoot({
          envFilePath: [],
          ignoreEnvVars: true,
          validate: () => {
            throw new RangeError("PORT is required");
          },
        }),
      ], async (module) => {
        await assertRejects(
          () => module.get(ConfigService),
          RangeError,
          "PORT is required",
        );
        assert(
          errorStub.calls.some((call) =>
            String(call.args[0]).includes("PORT is required")
          ),
        );
      });
    });
  });

  describe("forRootAsync", () => {
    it("resolves options through injected and extra providers", async () => {
      using _files = stubFiles({ "async.yaml": "source: yaml" });

      await withModule([
        ConfigModule.forRootAsync({
          imports: [AppNameModule],
          inject: [APP_NAME, YAML_PATH],
          extraProviders: [{ provide: YAML_PATH, useValue: "async.yaml" }],
          useFactory: (name: string, yamlFilePath: string) =>
            Promise.resolve({
              yamlFilePath,
              envFilePath: [],
              ignoreEnvVars: true,
              load: [() => ({ name })],
            }),
        }),
      ], async (module) => {
        const config = await module.get(ConfigService);

        assertEquals(config.get("name"), "from-provider");
        assertEquals(config.get("source"), "yaml");
      });
    });

    it("configures plain ConfigModule imports listed after it", async () => {
      using _files = stubFiles({});

      await withModule([
        ConfigModule.forRootAsync({ useFactory: () => rootOptions }),
        FeatureModule,
      ], async (module) => {
        const feature = await module.get(FeatureService);

        assertEquals(feature.config.get("name"), "root");
      });
    });

    it("fails loudly when a plain ConfigModule import comes first", async () => {
      using _files = stubFiles({});
      using errorStub = stub(Logger.prototype, "error");

      await withModule([
        FeatureModule,
        ConfigModule.forRootAsync({
          imports: [AppNameModule],
          inject: [APP_NAME],
          useFactory: () => rootOptions,
        }),
      ], async (module) => {
        await assertRejects(
          () => module.get(ConfigService),
          ConfigModuleImportOrderError,
          "list ConfigModule.forRootAsync() before any module importing ConfigModule",
        );
        assert(
          errorStub.calls.some((call) =>
            String(call.args[0]).includes("ConfigModule was imported before")
          ),
        );
      });
    });

    it("shares one service loaded once when registered globally, in any order", async () => {
      using _files = stubFiles({});

      for (const first of [true, false]) {
        const factory = spy(() => ({ name: "global" }));
        const configModule = ConfigModule.forRootAsync({
          global: true,
          useFactory: () => ({
            envFilePath: [],
            ignoreEnvVars: true,
            load: [factory],
          }),
        });

        await withModule(
          first
            ? [configModule, GlobalConsumerModule, FeatureModule]
            : [FeatureModule, GlobalConsumerModule, configModule],
          async (module) => {
            const consumer = await module.get(GlobalConsumer);
            const feature = await module.get(FeatureService);

            assertEquals(consumer.config.get("name"), "global");
            assertStrictEquals(consumer.config, feature.config);
            assertStrictEquals(
              consumer.config,
              await module.get(ConfigService),
            );
            assertEquals(factory.calls.length, 1);
          },
        );
      }
    });

    it("resolves injected providers from its imports for global consumers", async () => {
      using _files = stubFiles({});
      using errorStub = stub(Logger.prototype, "error");

      for (const first of [true, false]) {
        const configModule = ConfigModule.forRootAsync({
          global: true,
          imports: [AppNameModule],
          inject: [APP_NAME],
          useFactory: (name: string) => ({
            envFilePath: [],
            ignoreEnvVars: true,
            load: [() => ({ name })],
          }),
        });

        await withModule(
          first
            ? [configModule, GlobalConsumerModule, FeatureModule]
            : [FeatureModule, GlobalConsumerModule, configModule],
          async (module) => {
            const consumer = await module.get(GlobalConsumer);
            const feature = await module.get(FeatureService);

            assertEquals(consumer.config.get("name"), "from-provider");
            assertEquals(feature.config.get("name"), "from-provider");
          },
        );
      }

      assertEquals(errorStub.calls.length, 0);
    });
  });
});
