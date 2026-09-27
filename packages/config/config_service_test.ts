import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { assertType, type IsExact } from "@std/testing/types";
import { describe, it } from "node:test";
import {
  type ConfigPath,
  type ConfigPathValue,
  ConfigService,
} from "./config_service.ts";
import { ConfigKeyNotFoundError } from "./exceptions.ts";

interface AppConfig {
  PORT: string;
  database: {
    host: string;
    port: number;
    replicas: { host: string }[];
  };
  cache?: { ttl: number };
}

interface Tree {
  value: number;
  child: Tree;
}

const appConfig: AppConfig = {
  PORT: "8080",
  database: {
    host: "localhost",
    port: 5432,
    replicas: [{ host: "replica-1" }],
  },
  cache: { ttl: 60 },
};

describe(ConfigService.name, () => {
  describe("get", () => {
    const config = new ConfigService<Record<string, unknown>>({
      PORT: "8080",
      database: { host: "localhost", port: 5432 },
      replicas: [{ host: "replica-1" }],
      label: "text",
      nothing: null,
      zero: 0,
      disabled: false,
      empty: "",
    });

    it("reads top level and nested values by dot path", () => {
      assertEquals(config.get("PORT"), "8080");
      assertEquals(config.get("database.port"), 5432);
      assertEquals(config.get("database"), { host: "localhost", port: 5432 });
    });

    it("reads array elements by index", () => {
      assertEquals(config.get("replicas.0.host"), "replica-1");
      assertEquals(config.get("replicas.1.host"), undefined);
    });

    it("returns undefined for missing keys and non-object parents", () => {
      assertEquals(config.get("missing"), undefined);
      assertEquals(config.get("database.missing"), undefined);
      assertEquals(config.get("label.length"), undefined);
      assertEquals(config.get("nothing.key"), undefined);
    });

    it("ignores inherited properties", () => {
      assertEquals(config.get("toString"), undefined);
      assertEquals(config.get("constructor"), undefined);
      assertEquals(config.get("__proto__"), undefined);
      assertEquals(config.get("database.hasOwnProperty"), undefined);
    });

    it("falls back to the default only when the key is undefined", () => {
      assertEquals(config.get("missing", "fallback"), "fallback");
      assertEquals(config.get("database.port", 1), 5432);
      assertStrictEquals(config.get("nothing", "fallback"), null);
      assertStrictEquals(config.get("zero", 1), 0);
      assertStrictEquals(config.get("disabled", true), false);
      assertStrictEquals(config.get("empty", "fallback"), "");
    });
  });

  describe("getOrThrow", () => {
    const config = new ConfigService<Record<string, unknown>>({
      database: { port: 5432 },
      nothing: null,
    });

    it("returns set values including null", () => {
      assertEquals(config.getOrThrow("database.port"), 5432);
      assertStrictEquals(config.getOrThrow("nothing"), null);
    });

    it("throws ConfigKeyNotFoundError for missing keys", () => {
      const error = assertThrows(
        () => config.getOrThrow("database.host"),
        ConfigKeyNotFoundError,
        'Configuration key "database.host" does not exist',
      );

      assertInstanceOf(error, Error);
      assertEquals(error.path, "database.host");
      assertEquals(error.name, "ConfigKeyNotFoundError");
    });
  });

  describe("types", () => {
    it("derives dot paths from the configuration shape", () => {
      assertType<
        IsExact<
          ConfigPath<AppConfig>,
          | "PORT"
          | "database"
          | "database.host"
          | "database.port"
          | "database.replicas"
          | "cache"
          | "cache.ttl"
        >
      >(true);
      assertType<IsExact<ConfigPath<Record<string, unknown>>, string>>(true);
    });

    it("resolves value types for paths", () => {
      assertType<IsExact<ConfigPathValue<AppConfig, "database.port">, number>>(
        true,
      );
      assertType<IsExact<ConfigPathValue<AppConfig, "cache.ttl">, number>>(
        true,
      );
      assertType<IsExact<ConfigPathValue<AppConfig, "database.nope">, unknown>>(
        true,
      );
      assertType<IsExact<ConfigPathValue<AppConfig, "nope.deeper">, unknown>>(
        true,
      );
    });

    it("stops at a fixed depth for recursive shapes", () => {
      const path: ConfigPath<Tree> = "child.child.child.value";

      assertEquals(path.split(".").length, 4);
    });

    it("infers return types from typed configurations", () => {
      const config = new ConfigService<AppConfig>(appConfig);

      const host = config.get("database.host");
      const port = config.get("database.port", 1);
      const ttl = config.getOrThrow("cache.ttl");
      const replicas = config.get("database.replicas");

      assertType<IsExact<typeof host, string | undefined>>(true);
      assertType<IsExact<typeof port, number>>(true);
      assertType<IsExact<typeof ttl, number>>(true);
      assertType<IsExact<typeof replicas, { host: string }[] | undefined>>(
        true,
      );
      assertEquals(host, "localhost");
      assertEquals(port, 5432);
      assertEquals(ttl, 60);
    });

    it("uses explicit value types and defaults for untyped configurations", () => {
      const config = new ConfigService<Record<string, unknown>>({
        PORT: "8080",
      });

      const untyped = config.get("PORT");
      const explicit = config.get<string>("PORT");
      const withDefault = config.get("TIMEOUT", 30);
      const explicitDefault = config.get<number>("TIMEOUT", 30);
      const required = config.getOrThrow<string>("PORT");

      assertType<IsExact<typeof untyped, unknown>>(true);
      assertType<IsExact<typeof explicit, string | undefined>>(true);
      assertType<IsExact<typeof withDefault, number>>(true);
      assertType<IsExact<typeof explicitDefault, number>>(true);
      assertType<IsExact<typeof required, string>>(true);
      assertEquals(withDefault, 30);
      assertEquals(required, "8080");
    });
  });
});
