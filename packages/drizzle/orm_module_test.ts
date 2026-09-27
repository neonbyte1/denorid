import {
  Inject,
  Injectable,
  InjectorContext,
  Module,
  type OnModuleDestroy,
} from "@denorid/injector";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { describe, it } from "node:test";
import { DrizzleGenerateCommand } from "./commands/migrations_generate.ts";
import { DrizzleMigrateCommand } from "./commands/migrations_migrate.ts";
import { DrizzleService } from "./drizzle_service.ts";
import { DrizzleOrmModule } from "./mod.ts";

/**
 * Provider of the importing module that queries through the injected
 * {@linkcode DrizzleService}.
 */
@Injectable()
class UsersRepository {
  @Inject(DrizzleService)
  public readonly drizzle!: DrizzleService;

  public async selectOne(): Promise<number> {
    const row = await this.drizzle.sqlite().get<{ one: number }>(
      "select 1 as one",
    );

    return row.one;
  }
}

describe("DrizzleOrmModule", () => {
  describe("register", () => {
    it("provides DrizzleService with the configured connection to the importing module", async () => {
      @Module({
        imports: [
          DrizzleOrmModule.register({ type: "sqlite", database: ":memory:" }),
        ],
        providers: [UsersRepository],
        exports: [UsersRepository],
      })
      class AppModule {}

      await using ctx = await InjectorContext.create(AppModule);
      const repository = await ctx.resolve(UsersRepository);

      assertEquals(await repository.selectOne(), 1);
    });

    it("shares one DrizzleService with modules that do not import it when global", async () => {
      @Module({ providers: [UsersRepository], exports: [UsersRepository] })
      class UsersModule {}

      @Module({
        imports: [
          DrizzleOrmModule.register({ type: "sqlite", database: ":memory:" }, {
            global: true,
          }),
          UsersModule,
        ],
      })
      class AppModule {}

      await using ctx = await InjectorContext.create(AppModule);
      const repository = await ctx.resolveInternal(UsersRepository);

      assertEquals(await repository.selectOne(), 1);
      assertStrictEquals(
        repository.drizzle,
        await ctx.resolveInternal(DrizzleService),
      );
    });

    it("exposes the CLI commands to the console runner", async () => {
      @Module({ imports: [DrizzleOrmModule.register([])] })
      class AppModule {}

      await using ctx = await InjectorContext.create(AppModule);

      assertInstanceOf(
        await ctx.resolveInternal(DrizzleGenerateCommand),
        DrizzleGenerateCommand,
      );
      assertInstanceOf(
        await ctx.resolveInternal(DrizzleMigrateCommand),
        DrizzleMigrateCommand,
      );
    });
  });

  describe("registerAsync", () => {
    it("builds the connections from a factory without dependencies", async () => {
      @Module({
        imports: [
          DrizzleOrmModule.registerAsync({
            useFactory: () =>
              Promise.resolve({ type: "sqlite", database: ":memory:" }),
          }),
        ],
        providers: [UsersRepository],
        exports: [UsersRepository],
      })
      class AppModule {}

      await using ctx = await InjectorContext.create(AppModule);
      const repository = await ctx.resolve(UsersRepository);

      assertEquals(await repository.selectOne(), 1);
    });

    it("resolves inject tokens exported by the modules listed in imports", async () => {
      class DatabaseConfig {
        public readonly database = ":memory:";
      }

      @Module({ providers: [DatabaseConfig], exports: [DatabaseConfig] })
      class ConfigModule {}

      @Module({
        imports: [
          DrizzleOrmModule.registerAsync({
            imports: [ConfigModule],
            inject: [DatabaseConfig],
            useFactory: (config: DatabaseConfig) => ({
              type: "sqlite",
              database: config.database,
            }),
          }),
        ],
        providers: [UsersRepository],
        exports: [UsersRepository],
      })
      class AppModule {}

      await using ctx = await InjectorContext.create(AppModule);
      const repository = await ctx.resolve(UsersRepository);

      assertEquals(await repository.selectOne(), 1);
    });
  });

  describe("shutdown", () => {
    it("closes the connections after the shutdown hooks of other providers", async () => {
      @Injectable()
      class AuditLog implements OnModuleDestroy {
        @Inject(UsersRepository)
        public readonly repository!: UsersRepository;

        public queriedOnDestroy?: number;

        public async onModuleDestroy(): Promise<void> {
          this.queriedOnDestroy = await this.repository.selectOne();
        }
      }

      @Module({
        imports: [
          DrizzleOrmModule.register({ type: "sqlite", database: ":memory:" }),
        ],
        providers: [UsersRepository, AuditLog],
        exports: [UsersRepository, AuditLog],
      })
      class AppModule {}

      const ctx = await InjectorContext.create(AppModule);
      const audit = await ctx.resolve(AuditLog);
      const drizzle = audit.repository.drizzle;
      const db = drizzle.sqlite();

      await ctx.close();

      assertEquals(audit.queriedOnDestroy, 1);
      assertEquals(drizzle.sqlite({ noThrow: true }), undefined);
      await assertRejects(() => db.get("select 1"));
    });
  });
});
