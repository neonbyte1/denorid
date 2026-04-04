// deno-coverage-ignore-file

/**
 * Module for integrating drizzle ORM into the Denorid framework.
 *
 * ## Supported databases / drivers
 * - PostgreSQL (`node-postgres`)
 * - SQLite (`libsql`)
 *
 * ### Basic Usage
 *
 * ```ts
 * import { DrizzleOrmModule, DrizzleService } from "@denorid/drizzle";
 * import * as schema from "./db/schema.ts";
 *
 * // Register the module
 * \@Module({
 *   imports: [
 *     DrizzleOrmModule.register({
 *       type: "postgres",
 *       connection: "postgresql://localhost/mydb",
 *       pool: true,
 *       drizzle: { schema, }
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // Use in a service
 * \@Injectable()
 * export class UserService {
 *   \@Inject(DrizzleService)
 *   private readonly drizzle!: DrizzleService;
 *
 *   public async getUsers() {
 *     const db = this.drizzle.pg<typeof schema>();
 *
 *     return db.query.users.findMany();
 *   }
 * }
 * ```
 *
 * @see {@link https://orm.drizzle.team | Drizzle ORM Documentation}
 * @see {@link https://node-postgres.com | node-postgres Documentation}
 * @see {@link https://docs.turso.tech/libsql | LibSQL Documentation}
 *
 * @module
 */

export * from "./drizzle_service.ts";
export * from "./errors.ts";
export * from "./module_options.ts";
export * from "./orm_module.ts";
