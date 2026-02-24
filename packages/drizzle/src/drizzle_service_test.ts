import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy, type Stub, stub } from "@std/testing/mock";
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

  beforeEach(() => {
    service = new DrizzleService();
    mockDrizzle.calls.length = 0;
  });

  afterEach(() => {
    importStub?.restore();
  });

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
      it("should create pooled connection with string connection", async () => {
        setOptions({
          type: "postgres",
          name: "pooled",
          connection: "postgresql://localhost/test",
          pool: true,
        });
        stubImport({
          "drizzle-orm/node-postgres": { drizzle: mockDrizzle },
          "pg": { Pool: MockPool },
        });

        await service.onModuleInit();

        assertSpyCalls(mockDrizzle, 1);
        assertEquals(service.pg("pooled") as unknown, MOCKED_CONNECTION);
      });

      it("should create pooled connection with object config", async () => {
        setOptions({
          type: "postgres",
          name: "pooled",
          connection: { host: "localhost", port: 5432 },
          pool: true,
        });
        stubImport({
          "drizzle-orm/node-postgres": { drizzle: mockDrizzle },
          "pg": { Pool: MockPool },
        });

        await service.onModuleInit();

        assertSpyCalls(mockDrizzle, 1);
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

        await assertRejects(
          () => service.onModuleInit(),
          DrizzleMissingDependencyError,
        );

        assertEquals(service.pg("no-pool", { noThrow: true }), undefined);
      });
    });

    describe("postgres without pool", () => {
      it("should pass drizzle options", async () => {
        const drizzleOpts = { logger: true };
        setOptions({
          type: "postgres",
          name: "direct",
          connection: "pg://test",
          drizzle: drizzleOpts,
        });
        stubImport({ "drizzle-orm/node-postgres": { drizzle: mockDrizzle } });

        await service.onModuleInit();

        assertEquals(mockDrizzle.calls[0].args, ["pg://test", drizzleOpts]);
      });
    });

    describe("sqlite options", () => {
      it("should pass drizzle options", async () => {
        const drizzleOpts = { logger: true };
        setOptions({
          type: "sqlite",
          name: "opts",
          database: ":memory:",
          drizzle: drizzleOpts,
        });
        stubImport({ "drizzle-orm/libsql": { drizzle: mockDrizzle } });

        await service.onModuleInit();

        assertEquals(mockDrizzle.calls[0].args, [":memory:", drizzleOpts]);
      });
    });

    describe("factory caching", () => {
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
      it("should throw when drizzle import fails", async () => {
        setOptions({ type: "postgres", name: "fail", connection: "pg://x" });
        stubImport({});

        await assertRejects(
          () => service.onModuleInit(),
          DrizzleFactoryNotFoundError,
        );
      });
    });
  });

  describe("pg", () => {
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
      assertThrows(() => empty.pg()), DrizzleConnectionNotFoundError;
    });
  });

  describe("sqlite", () => {
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
});
