import { ConfigKeyNotFoundError } from "./exceptions.ts";

type PathDepth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Dot separated paths into `T`, e.g. `"database" | "database.port"` for
 * `{ database: { port: number } }`. Arrays are leaves. Untyped configurations
 * (`Record<string, unknown>`) accept any `string`. Nesting stops after ten
 * levels so recursive types stay usable.
 *
 * @template T - The configuration shape.
 * @template D - Remaining nesting depth (internal).
 */
export type ConfigPath<T, D extends number = 9> = [D] extends [never] ? never
  : T extends readonly unknown[] ? never
  : T extends object ? {
      [K in keyof T & string]: NonNullable<T[K]> extends readonly unknown[] ? K
        : NonNullable<T[K]> extends object
          ? K | `${K}.${ConfigPath<NonNullable<T[K]>, PathDepth[D]>}`
        : K;
    }[keyof T & string]
  : never;

/**
 * Type of the value found at `P` inside `T`; `unknown` when `P` is not a
 * known path.
 *
 * @template T - The configuration shape.
 * @template P - Dot separated path.
 */
export type ConfigPathValue<T, P extends string> = P extends keyof T ? T[P]
  : P extends `${infer K}.${infer R}`
    ? K extends keyof T ? ConfigPathValue<NonNullable<T[K]>, R> : unknown
  : unknown;

/**
 * Explicit value type `V`, or the type inferred from the path when `V` is
 * omitted.
 */
type ResolvedValue<V, T, P extends string> = [V] extends [never]
  ? ConfigPathValue<T, P>
  : V;

/**
 * Accepted default for a value of type `R`.
 */
type DefaultFor<R> = unknown extends R ? unknown : Exclude<R, undefined>;

/**
 * Widens literal types (`30` to `number`) so defaults of untyped values do not
 * produce overly narrow results.
 */
type Widen<D> = D extends string ? string
  : D extends number ? number
  : D extends boolean ? boolean
  : D extends bigint ? bigint
  : D;

/**
 * Result of a lookup with a default value `D`.
 */
type WithDefault<R, D> = unknown extends R ? Widen<D>
  : Exclude<R, undefined> | D;

/**
 * Read-only access to the loaded configuration.
 *
 * Provided by `ConfigModule`. Values are looked up by dot separated paths:
 * `database.port` reads `port` from the `database` object, environment
 * variables live at the top level (`PORT`).
 *
 * @template T - The configuration shape, enables typed paths and values.
 *
 * @example
 * ```ts
 * interface AppConfig {
 *   PORT: string;
 *   database: { host: string; port: number };
 * }
 *
 * \@Injectable()
 * class DatabaseService {
 *   \@Inject(ConfigService)
 *   private readonly config!: ConfigService<AppConfig>;
 *
 *   public url(): string {
 *     const host = this.config.getOrThrow("database.host"); // string
 *     const port = this.config.get("database.port", 5432); // number
 *
 *     return `postgres://${host}:${port}`;
 *   }
 * }
 * ```
 */
export class ConfigService<T extends object = Record<string, unknown>> {
  /**
   * @param {T} config - The configuration to expose.
   */
  public constructor(private readonly config: T) {}

  /**
   * Reads the value at `path`.
   *
   * @template V - Explicit value type; inferred from `T` when omitted.
   * @template P - Dot separated path.
   * @param {P} path - Dot separated path, e.g. `database.port`.
   * @return {ResolvedValue<V, T, P> | undefined} The value, or `undefined`
   *   when the key is not set.
   */
  public get<V = never, P extends ConfigPath<T> = ConfigPath<T>>(
    path: P,
  ): ResolvedValue<V, T, P> | undefined;
  /**
   * Reads the value at `path`, falling back to `defaultValue` when the key is
   * not set.
   *
   * @template V - Explicit value type; inferred from `T` when omitted.
   * @template P - Dot separated path.
   * @template D - Type of the default value.
   * @param {P} path - Dot separated path, e.g. `database.port`.
   * @param {D} defaultValue - Returned when the key is not set.
   * @return {WithDefault<ResolvedValue<V, T, P>, D>} The value or
   *   `defaultValue`.
   */
  public get<
    V = never,
    P extends ConfigPath<T> = ConfigPath<T>,
    D extends DefaultFor<ResolvedValue<V, T, P>> = DefaultFor<
      ResolvedValue<V, T, P>
    >,
  >(path: P, defaultValue: D): WithDefault<ResolvedValue<V, T, P>, D>;
  public get(path: string, defaultValue?: unknown): unknown {
    const value = this.lookup(path);

    return value === undefined ? defaultValue : value;
  }

  /**
   * Reads the value at `path` and throws when it is not set.
   *
   * @template V - Explicit value type; inferred from `T` when omitted.
   * @template P - Dot separated path.
   * @param {P} path - Dot separated path, e.g. `database.port`.
   * @return {Exclude<ResolvedValue<V, T, P>, undefined>} The value.
   * @throws {ConfigKeyNotFoundError} When the key is not set.
   */
  public getOrThrow<V = never, P extends ConfigPath<T> = ConfigPath<T>>(
    path: P,
  ): Exclude<ResolvedValue<V, T, P>, undefined> {
    const value = this.lookup(path);

    if (value === undefined) {
      throw new ConfigKeyNotFoundError(path);
    }

    return value as Exclude<ResolvedValue<V, T, P>, undefined>;
  }

  private lookup(path: string): unknown {
    let current: unknown = this.config;

    for (const segment of path.split(".")) {
      if (
        typeof current !== "object" || current === null ||
        !Object.hasOwn(current, segment)
      ) {
        return undefined;
      }

      current = (current as Record<string, unknown>)[segment];
    }

    return current;
  }
}
