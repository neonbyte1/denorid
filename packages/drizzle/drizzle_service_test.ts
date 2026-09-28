import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { assertSpyCalls, spy, type Stub, stub } from "@std/testing/mock";
import { sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { sqliteTable } from "drizzle-orm/sqlite-core";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { MODULE_OPTIONS } from "./_internal.ts";
import { DrizzleService } from "./drizzle_service.ts";
import {
  DrizzleConnectionNotFoundError,
  DrizzleFactoryNotFoundError,
  DrizzleMissingDependencyError,
} from "./errors.ts";

const MOCKED_CONNECTION = { db: "mocked" };

describe("DrizzleService", () => {
  let service: DrizzleService;
  let importStub: Stub;

  const mockDrizzle = spy((..._args: unknown[]) => MOCKED_CONNECTION);
  const MockPool = class {
    constructor(public config: unknown) {}
  };

  function useService(): void {
    beforeEach(() => {
      service = new DrizzleService();
      mockDrizzle.calls.length = 0;
    });

    afterEach(() => {
      importStub?.restore();
    });
  }

  const setOptions = (options: unknown) => {
    Object.defineProperty(service, MODULE_OPTIONS, {
      value: options,
      writable: true,
    });
  };

  const stubImport = (responses: Record<string, unknown>) => {
    importStub = stub(
      service,
      // @ts-ignore - seems dirty but otherwise TS doesn't allow us accessing privat methods for stubbing
      "import",
      (name: string) => Promise.resolve(responses[name] ?? {}),
    );
  };

  describe("onModuleInit", () => {
    describe("single connection (non-array options)", () => {
      useService();

      it("should initialize postgres with default name", async () => {
        setOptions({
          type: "postgres",
          connection: "postgresql://localhost:5432/test",
        });
        stubImport({ "drizzle-orm/node-postgres": { drizzle: mockDrizzle } });

        await service.onModuleInit();

        assertSpyCalls(mockDrizzle, 1);
        assertEquals(service.pg() as unknown, MOCKED_CONNECTION);
      });

      it("should initialize sqlite with default name", async () => {
        setOptions({
          type: "sqlite",
          database: ":memory:",
        });
        stubImport({ "drizzle-orm/libsql": { drizzle: mockDrizzle } });

        await service.onModuleInit();

        assertSpyCalls(mockDrizzle, 1);
        assertEquals(service.sqlite() as unknown, MOCKED_CONNECTION);
      });
    });

    describe("array of connections", () => {
      useService();

      it("should initialize multiple postgres connections", async () => {
        setOptions([
          { type: "postgres", name: "primary", connection: "pg://primary" },
          { type: "postgres", name: "secondary", connection: "pg://secondary" },
        ]);
        stubImport({ "drizzle-orm/node-postgres": { drizzle: mockDrizzle } });

        await service.onModuleInit();

        assertSpyCalls(mockDrizzle, 2);
        assertEquals(service.pg("primary") as unknown, MOCKED_CONNECTION);
        assertEquals(service.pg("secondary") as unknown, MOCKED_CONNECTION);
      });

      it("should initialize multiple sqlite connections", async () => {
        setOptions([
          { type: "sqlite", name: "db1", database: ":memory:" },
          { type: "sqlite", name: "db2", database: "./test.db" },
        ]);
        stubImport({ "drizzle-orm/libsql": { drizzle: mockDrizzle } });

        await service.onModuleInit();

        assertSpyCalls(mockDrizzle, 2);
        assertEquals(service.sqlite("db1") as unknown, MOCKED_CONNECTION);
        assertEquals(service.sqlite("db2") as unknown, MOCKED_CONNECTION);
      });

      it("should initialize mixed postgres and sqlite connections", async () => {
        setOptions([
          { type: "postgres", name: "pg", connection: "pg://test" },
          { type: "sqlite", name: "sqlite", database: ":memory:" },
        ]);
        stubImport({
          "drizzle-orm/node-postgres": { drizzle: mockDrizzle },
          "drizzle-orm/libsql": { drizzle: mockDrizzle },
        });

        await service.onModuleInit();

        assertEquals(service.pg("pg") as unknown, MOCKED_CONNECTION);
        assertEquals(service.sqlite("sqlite") as unknown, MOCKED_CONNECTION);
      });
    });

    describe("postgres with pool", () => {
      useService();

      it("should create pooled connection with string connection", async () => {
        const drizzleOpts = { logger: true, relations: {} };
        setOptions({
          type: "postgres",
          name: "pooled",
          connection: "postgresql://localhost/test",
          pool: true,
          drizzle: drizzleOpts,
        });
        stubImport({
          "drizzle-orm/node-postgres": { drizzle: mockDrizzle },
          "pg": { Pool: MockPool },
        });

        await service.onModuleInit();

        assertEquals(mockDrizzle.calls[0].args, [{
          ...drizzleOpts,
          client: new MockPool({
            connectionString: "postgresql://localhost/test",
          }),
        }]);
        assertEquals(service.pg("pooled") as unknown, MOCKED_CONNECTION);
      });

      it("should create pooled connection with object config", async () => {
        const connection = { host: "localhost", port: 5432 };
        setOptions({
          type: "postgres",
          name: "pooled",
          connection,
          pool: true,
        });
        stubImport({
          "drizzle-orm/node-postgres": { drizzle: mockDrizzle },
          "pg": { Pool: MockPool },
        });

        await service.onModuleInit();

        assertEquals(mockDrizzle.calls[0].args, [{
          client: new MockPool(connection),
        }]);
      });

      it("should reuse Pool class for multiple pooled connections", async () => {
        let poolImportCount = 0;
        setOptions([
          { type: "postgres", name: "pool1", connection: "pg://1", pool: true },
          { type: "postgres", name: "pool2", connection: "pg://2", pool: true },
        ]);
        importStub = stub(
          service,
          // @ts-ignore - seems dirty but otherwise TS doesn't allow us accessing privat methods for stubbing
          "import",
          (name: string) => {
            if (name === "pg") {
              poolImportCount++;
              return { Pool: MockPool };
            }
            return { drizzle: mockDrizzle };
          },
        );

        await service.onModuleInit();

        assertEquals(poolImportCount, 1);
      });

      it("should throw when Pool import fails", async () => {
        setOptions({
          type: "postgres",
          name: "no-pool",
          connection: "pg://test",
          pool: true,
        });
        stubImport({
          "drizzle-orm/node-postgres": { drizzle: mockDrizzle },
          "pg": {},
        });

        const error = await assertRejects(
          () => service.onModuleInit(),
          DrizzleMissingDependencyError,
        );

        assertEquals(error.cause, undefined);
        assertEquals(service.pg("no-pool", { noThrow: true }), undefined);
      });

      it("should keep the pg import error as cause", async () => {
        const importError = new Error("Cannot find module 'pg'");
        setOptions({
          type: "postgres",
          connection: "pg://test",
          pool: true,
        });
        importStub = stub(
          service,
          // @ts-ignore - seems dirty but otherwise TS doesn't allow us accessing privat methods for stubbing
          "import",
          (name: string) =>
            name === "pg"
              ? Promise.reject(importError)
              : Promise.resolve({ drizzle: mockDrizzle }),
        );

        const error = await assertRejects(
          () => service.onModuleInit(),
          DrizzleMissingDependencyError,
        );

        assertStrictEquals(error.cause, importError);
      });
    });

    describe("postgres without pool", () => {
      useService();

      it("should pass drizzle options next to a connection string", async () => {
        const drizzleOpts = { logger: true };
        setOptions({
          type: "postgres",
          name: "direct",
          connection: "pg://test",
          drizzle: drizzleOpts,
        });
        stubImport({ "drizzle-orm/node-postgres": { drizzle: mockDrizzle } });

        await service.onModuleInit();

        assertEquals(mockDrizzle.calls[0].args, [{
          logger: true,
          connection: "pg://test",
        }]);
      });

      it("should pass an object connection as connection config", async () => {
        const connection = { host: "db.prod.internal", port: 6543 };
        setOptions({
          type: "postgres",
          connection,
          pool: false,
          drizzle: { logger: true },
        });
        stubImport({ "drizzle-orm/node-postgres": { drizzle: mockDrizzle } });

        await service.onModuleInit();

        assertEquals(mockDrizzle.calls[0].args, [{ logger: true, connection }]);
      });
    });

    describe("sqlite options", () => {
      useService();

      it("should pass drizzle options", async () => {
        const drizzleOpts = { logger: true };
        setOptions({
          type: "sqlite",
          name: "opts",
          database: "libsql://db.turso.io",
          drizzle: drizzleOpts,
        });
        stubImport({ "drizzle-orm/libsql": { drizzle: mockDrizzle } });

        await service.onModuleInit();

        assertEquals(mockDrizzle.calls[0].args, [
          "libsql://db.turso.io",
          drizzleOpts,
        ]);
      });

      for (
        const [database, url] of [
          ["./local.db", "file:./local.db"],
          ["/var/data/app.db", "file:/var/data/app.db"],
          ["C:\\data\\app.db", "file:C:\\data\\app.db"],
          ["./a#b%c?.db", "file:./a%23b%25c%3F.db"],
          [":memory:", "file::memory:"],
          ["file:./local.db", "file:./local.db"],
          ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
        ]
      ) {
        it(`should open "${database}" as "${url}"`, async () => {
          setOptions({ type: "sqlite", database });
          stubImport({ "drizzle-orm/libsql": { drizzle: mockDrizzle } });

          await service.onModuleInit();

          assertEquals(mockDrizzle.calls[0].args, [url, undefined]);
        });
      }
    });

    describe("factory caching", () => {
      useService();

      it("should reuse drizzle factory for same driver", async () => {
        let importCount = 0;
        setOptions([
          { type: "postgres", name: "a", connection: "pg://a" },
          { type: "postgres", name: "b", connection: "pg://b" },
        ]);
        importStub = stub(
          service,
          // @ts-ignore - seems dirty but otherwise TS doesn't allow us accessing privat methods for stubbing
          "import",
          () => {
            importCount++;
            return { drizzle: mockDrizzle };
          },
        );

        await service.onModuleInit();

        assertEquals(importCount, 1);
      });
    });

    describe("error handling", () => {
      useService();

      it("should throw when drizzle import fails", async () => {
        setOptions({ type: "postgres", name: "fail", connection: "pg://x" });
        stubImport({});

        const error = await assertRejects(
          () => service.onModuleInit(),
          DrizzleFactoryNotFoundError,
        );

        assertEquals(error.cause, undefined);
      });

      it("should keep the driver import error as cause", async () => {
        const importError = new Error("Cannot find module '@libsql/client'");
        setOptions({ type: "sqlite", database: ":memory:" });
        importStub = stub(
          service,
          // @ts-ignore - seems dirty but otherwise TS doesn't allow us accessing privat methods for stubbing
          "import",
          () => Promise.reject(importError),
        );

        const error = await assertRejects(
          () => service.onModuleInit(),
          DrizzleFactoryNotFoundError,
          "drizzle-orm/libsql",
        );

        assertStrictEquals(error.cause, importError);
      });
    });
  });

  describe("pg", () => {
    useService();

    beforeEach(async () => {
      setOptions([
        { type: "postgres", name: "default", connection: "pg://default" },
        { type: "postgres", name: "custom", connection: "pg://custom" },
      ]);
      stubImport({ "drizzle-orm/node-postgres": { drizzle: mockDrizzle } });
      await service.onModuleInit();
    });

    it("should return default connection", () => {
      assertEquals(service.pg() as unknown, MOCKED_CONNECTION);
    });

    it("should return default with noThrow: false", () => {
      assertEquals(
        service.pg({ noThrow: false }) as unknown,
        MOCKED_CONNECTION,
      );
    });

    it("should return named connection", () => {
      assertEquals(service.pg("custom") as unknown, MOCKED_CONNECTION);
    });

    it("should return named with noThrow: false", () => {
      assertEquals(
        service.pg("custom", { noThrow: false }) as unknown,
        MOCKED_CONNECTION,
      );
    });

    it("should return undefined with noThrow: true for missing", () => {
      assertEquals(service.pg("missing", { noThrow: true }), undefined);
    });

    it("should throw for missing connection", () => {
      assertThrows(() => service.pg("missing"), DrizzleConnectionNotFoundError);
    });

    it("should return undefined for missing default with noThrow", () => {
      const empty = new DrizzleService();
      assertEquals(empty.pg({ noThrow: true }), undefined);
    });

    it("should throw for missing default", () => {
      const empty = new DrizzleService();
      assertThrows(() => empty.pg(), DrizzleConnectionNotFoundError);
    });
  });

  describe("sqlite", () => {
    useService();

    beforeEach(async () => {
      setOptions([
        { type: "sqlite", name: "default", database: ":memory:" },
        { type: "sqlite", name: "custom", database: "./custom.db" },
      ]);
      stubImport({ "drizzle-orm/libsql": { drizzle: mockDrizzle } });
      await service.onModuleInit();
    });

    it("should return default connection", () => {
      assertEquals(service.sqlite() as unknown, MOCKED_CONNECTION);
    });

    it("should return default with noThrow: false", () => {
      assertEquals(
        service.sqlite({ noThrow: false }) as unknown,
        MOCKED_CONNECTION,
      );
    });

    it("should return named connection", () => {
      assertEquals(service.sqlite("custom") as unknown, MOCKED_CONNECTION);
    });

    it("should return named with noThrow: false", () => {
      assertEquals(
        service.sqlite("custom", { noThrow: false }) as unknown,
        MOCKED_CONNECTION,
      );
    });

    it("should return undefined with noThrow: true for missing", () => {
      assertEquals(service.sqlite("missing", { noThrow: true }), undefined);
    });

    it("should throw for missing connection", () => {
      assertThrows(
        () => service.sqlite("missing"),
        DrizzleConnectionNotFoundError,
      );
    });

    it("should return undefined for missing default with noThrow", () => {
      const service = new DrizzleService();

      assertEquals(service.sqlite({ noThrow: true }), undefined);
    });

    it("should throw for missing default", () => {
      const service = new DrizzleService();

      assertThrows(() => service.sqlite(), DrizzleConnectionNotFoundError);
    });
  });

  describe("[Symbol.asyncDispose]", () => {
    useService();

    it("should end postgres pools and close sqlite clients", async () => {
      const pool = { end: spy(() => Promise.resolve()) };
      const client = { close: spy(() => {}) };
      setOptions([
        { type: "postgres", name: "main", connection: "pg://main" },
        { type: "sqlite", name: "cache", database: ":memory:" },
      ]);
      stubImport({
        "drizzle-orm/node-postgres": { drizzle: () => ({ $client: pool }) },
        "drizzle-orm/libsql": { drizzle: () => ({ $client: client }) },
      });
      await service.onModuleInit();

      await service[Symbol.asyncDispose]();

      assertSpyCalls(pool.end, 1);
      assertSpyCalls(client.close, 1);
      assertEquals(service.pg("main", { noThrow: true }), undefined);
      assertEquals(service.sqlite("cache", { noThrow: true }), undefined);
    });

    it("should close every connection only once when disposed twice", async () => {
      const pool = { end: spy(() => Promise.resolve()) };
      setOptions({ type: "postgres", connection: "pg://main" });
      stubImport({
        "drizzle-orm/node-postgres": { drizzle: () => ({ $client: pool }) },
      });
      await service.onModuleInit();

      await service[Symbol.asyncDispose]();
      await service[Symbol.asyncDispose]();

      assertSpyCalls(pool.end, 1);
    });

    it("should close the remaining connections and aggregate every failure", async () => {
      const endError = new Error("end failed");
      const closeError = new Error("close failed");
      const healthy = { end: spy(() => Promise.resolve()) };
      const pools: Record<string, { end(): Promise<void> }> = {
        "pg://broken": { end: () => Promise.reject(endError) },
        "pg://healthy": healthy,
      };
      setOptions([
        { type: "postgres", name: "broken", connection: "pg://broken" },
        { type: "postgres", name: "healthy", connection: "pg://healthy" },
        { type: "sqlite", name: "cache", database: ":memory:" },
      ]);
      stubImport({
        "drizzle-orm/node-postgres": {
          drizzle: ({ connection }: { connection: string }) => ({
            $client: pools[connection],
          }),
        },
        "drizzle-orm/libsql": {
          drizzle: () => ({
            $client: {
              close: (): void => {
                throw closeError;
              },
            },
          }),
        },
      });
      await service.onModuleInit();

      const error = await assertRejects(
        () => service[Symbol.asyncDispose](),
        AggregateError,
      );

      assertSpyCalls(healthy.end, 1);
      assertEquals(
        error.errors.map((entry: Error) => [entry.message, entry.cause]),
        [
          ["Failed to close postgres connection: broken", endError],
          ["Failed to close sqlite connection: cache", closeError],
        ],
      );
    });

    it("should close the connections opened before onModuleInit failed", async () => {
      const pool = { end: spy(() => Promise.resolve()) };
      setOptions([
        { type: "postgres", name: "main", connection: "pg://main" },
        { type: "postgres", name: "pooled", connection: "pg://p", pool: true },
      ]);
      stubImport({
        "drizzle-orm/node-postgres": { drizzle: () => ({ $client: pool }) },
        "pg": {},
      });
      await assertRejects(
        () => service.onModuleInit(),
        DrizzleMissingDependencyError,
      );

      await service[Symbol.asyncDispose]();

      assertSpyCalls(pool.end, 1);
    });
  });

  describe("migrations", () => {
    let dir: string;
    let migrating: DrizzleService;

    function useMigrations(): void {
      beforeEach(async () => {
        dir = await Deno.makeTempDir();
        migrating = new DrizzleService();
      });

      afterEach(async () => {
        await migrating[Symbol.asyncDispose]();
        await Deno.remove(dir, { recursive: true });
      });
    }

    const configure = (options: unknown): void => {
      Object.defineProperty(migrating, MODULE_OPTIONS, { value: options });
    };

    /** Writes a migration the way `drizzle-kit generate` lays it out. */
    const writeMigration = async (
      name: string,
      statements: string,
    ): Promise<void> => {
      await Deno.mkdir(join(dir, "drizzle", name), { recursive: true });
      await Deno.writeTextFile(
        join(dir, "drizzle", name, "migration.sql"),
        statements,
      );
    };

    const tables = async (): Promise<string[]> =>
      (await migrating.sqlite().all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )).map(({ name }) => name);

    describe("sqlite", () => {
      useMigrations();

      it("applies the pending migrations on bootstrap, each one once", async () => {
        await writeMigration(
          "20260928120000_users",
          "CREATE TABLE users (id integer PRIMARY KEY, name text);",
        );
        configure({
          type: "sqlite",
          database: join(dir, "app.db"),
          migrations: { folder: pathToFileURL(join(dir, "drizzle")) },
        });
        await migrating.onModuleInit();

        await migrating.onApplicationBootstrap();

        assertEquals(await tables(), ["__drizzle_migrations", "users"]);

        await writeMigration(
          "20260928130000_posts",
          "CREATE TABLE posts (id integer PRIMARY KEY);",
        );
        await migrating.migrate();

        assertEquals(await tables(), [
          "__drizzle_migrations",
          "posts",
          "users",
        ]);
        assertEquals(
          await migrating.sqlite().all(
            sql`SELECT name FROM __drizzle_migrations ORDER BY id`,
          ),
          [{ name: "20260928120000_users" }, { name: "20260928130000_posts" }],
        );
      });

      it("leaves migrations with applyOnBootstrap: false to migrate()", async () => {
        await writeMigration(
          "20260928120000_users",
          "CREATE TABLE users (id integer PRIMARY KEY);",
        );
        configure([
          {
            type: "sqlite",
            name: "default",
            database: join(dir, "app.db"),
            migrations: {
              folder: join(dir, "drizzle"),
              table: "applied_migrations",
              applyOnBootstrap: false,
            },
          },
          { type: "sqlite", name: "cache", database: ":memory:" },
        ]);
        await migrating.onModuleInit();

        await migrating.onApplicationBootstrap();

        assertEquals(await tables(), []);

        await migrating.migrate();

        assertEquals(await tables(), ["applied_migrations", "users"]);
      });

      it("rejects naming the connection when a migration fails, applying none of the pending ones", async () => {
        await writeMigration(
          "20260928120000_users",
          "CREATE TABLE users (id integer PRIMARY KEY);",
        );
        await writeMigration("20260928130000_broken", "CREATE TABLE users;");
        configure([{
          type: "sqlite",
          name: "main",
          database: join(dir, "app.db"),
          migrations: { folder: join(dir, "drizzle") },
        }]);
        await migrating.onModuleInit();

        const error = await assertRejects(
          () => migrating.onApplicationBootstrap(),
          Error,
          "Failed to migrate sqlite connection: main",
        );

        assertInstanceOf(error.cause, Error);
        assertEquals(
          await migrating.sqlite("main").all(
            sql`SELECT name FROM sqlite_master WHERE name = 'users'`,
          ),
          [],
        );
      });

      it("rejects on bootstrap when the connection could not be established", async () => {
        configure({
          type: "sqlite",
          database: join(dir, "app.db"),
          migrations: { folder: join(dir, "drizzle") },
        });
        using _import = stub(
          migrating,
          // @ts-ignore - private import seam
          "import",
          () => Promise.resolve({}),
        );
        await assertRejects(
          () => migrating.onModuleInit(),
          DrizzleFactoryNotFoundError,
        );

        await assertRejects(
          () => migrating.onApplicationBootstrap(),
          DrizzleConnectionNotFoundError,
        );
      });
    });

    describe("postgres", () => {
      useMigrations();

      /**
       * Registers a postgres connection whose pool hands out one client
       * recording its calls, next to drizzle's migrator.
       */
      const usePostgres = async (
        migrations: Record<string, unknown>,
        migrate: (db: unknown) => Promise<void>,
      ) => {
        const calls: unknown[][] = [];
        const client = {
          query: (text: string, values: unknown[]) => {
            calls.push(["query", text, ...values]);

            return Promise.resolve();
          },
          release: (destroy?: boolean) => {
            calls.push(["release", destroy]);
          },
        };
        const pool = {
          connect: () => Promise.resolve(client),
          end: () => Promise.resolve(),
        };

        configure([{
          type: "postgres",
          name: "main",
          connection: "pg://main",
          drizzle: { logger: false },
          migrations,
        }]);
        const importStub = stub(
          migrating,
          // @ts-ignore - private import seam
          "import",
          (name: string) =>
            Promise.resolve(
              ({
                "drizzle-orm/node-postgres": {
                  drizzle: (config: { client?: unknown }) =>
                    config.client ? { onClient: config } : { $client: pool },
                },
                "drizzle-orm/node-postgres/migrator": {
                  migrate: (db: unknown, config: unknown) => {
                    calls.push(["migrate", db, config]);

                    return migrate(db);
                  },
                },
              } as Record<string, unknown>)[name] ?? {},
            ),
        );

        await migrating.onModuleInit();

        return { calls, client, importStub };
      };

      it("migrates on one pool client holding an advisory lock on the migrations table", async () => {
        const { calls, client, importStub } = await usePostgres(
          { folder: "./drizzle" },
          () => Promise.resolve(),
        );

        try {
          await migrating.onApplicationBootstrap();
        } finally {
          importStub.restore();
        }

        const [lock, migrate, unlock, release] = calls;

        assertEquals(lock.slice(0, 2), [
          "query",
          "SELECT pg_advisory_lock($1::bigint)",
        ]);
        assertEquals(migrate, ["migrate", {
          onClient: { logger: false, client },
        }, {
          migrationsFolder: "./drizzle",
          migrationsTable: "__drizzle_migrations",
          migrationsSchema: "drizzle",
        }]);
        assertEquals(unlock, [
          "query",
          "SELECT pg_advisory_unlock($1::bigint)",
          lock[2],
        ]);
        assertEquals(release, ["release", undefined]);
        assertEquals(calls.length, 4);
      });

      it("locks per migrations table", async () => {
        const keys: unknown[] = [];

        for (
          const migrations of [{}, { schema: "app" }, { table: "applied" }]
        ) {
          const { calls, importStub } = await usePostgres(
            { folder: "./drizzle", ...migrations },
            () => Promise.resolve(),
          );

          try {
            await migrating.migrate();
          } finally {
            importStub.restore();
            await migrating[Symbol.asyncDispose]();
            migrating = new DrizzleService();
          }

          keys.push(calls[0][2]);
        }

        assertEquals(new Set(keys).size, 3);
      });

      it("destroys the client of a failed migration, releasing its lock", async () => {
        const failure = new Error("relation already exists");
        const { calls, importStub } = await usePostgres(
          { folder: "./drizzle" },
          () => Promise.reject(failure),
        );

        try {
          const error = await assertRejects(
            () => migrating.migrate(),
            Error,
            "Failed to migrate postgres connection: main",
          );

          assertStrictEquals(error.cause, failure);
        } finally {
          importStub.restore();
        }

        assertEquals(calls.map(([call]) => call), [
          "query",
          "migrate",
          "release",
        ]);
        assertEquals(calls[2], ["release", true]);
      });
    });
  });

  describe("deno.json map integrity", () => {
    it("should statically resolve drizzle-orm/pg-core", () => {
      assertEquals(typeof pgTable, "function");
    });

    it("should statically resolve drizzle-orm/sqlite-core", () => {
      assertEquals(typeof sqliteTable, "function");
    });
  });
});
