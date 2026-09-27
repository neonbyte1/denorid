import type {
  GenericFunction,
  InjectionToken,
  ModuleMetadata,
  Provider,
} from "@denorid/injector";

/**
 * Location of a configuration file. Relative paths resolve against the
 * current working directory; use a `URL` (e.g.
 * `new URL("./config.yaml", import.meta.url)`) for module relative files.
 */
export type ConfigFilePath = string | URL;

/**
 * Plain configuration object produced by files, factories and validation.
 */
export type ConfigRecord = Record<string, unknown>;

/**
 * Custom configuration source, merged on top of the YAML files.
 *
 * @param {Readonly<Record<string, string>>} env - Environment variables from
 *   the `.env` files and the runtime (unless `ignoreEnvVars` is set).
 * @return {ConfigRecord | Promise<ConfigRecord>} Configuration to merge.
 */
export type ConfigFactory = (
  env: Readonly<Record<string, string>>,
) => ConfigRecord | Promise<ConfigRecord>;

/**
 * Validates the merged configuration.
 *
 * @param {ConfigRecord} config - The merged configuration.
 * @return {ConfigRecord | Promise<ConfigRecord>} The configuration exposed by
 *   `ConfigService`, e.g. with coerced values. Throw to reject it.
 */
export type ConfigValidator = (
  config: ConfigRecord,
) => ConfigRecord | Promise<ConfigRecord>;

/**
 * Options of {@link ConfigModule.forRoot}.
 *
 * Sources are merged in this order, later ones win: `yamlFilePath`, `load`,
 * `envFilePath`, runtime environment variables. Objects are merged deeply,
 * every other value (including arrays) is replaced.
 */
export interface ConfigModuleOptions {
  /** When `true`, `ConfigService` is injectable without importing the module. */
  global?: boolean;
  /**
   * YAML files merged in order, later files override earlier ones. Every file
   * must contain a mapping at the top level. Missing files are skipped.
   */
  yamlFilePath?: ConfigFilePath | ConfigFilePath[];
  /**
   * `.env` files merged in order, later files override earlier ones. Missing
   * files are skipped. Pass `[]` to load none.
   *
   * @default ".env"
   */
  envFilePath?: ConfigFilePath | ConfigFilePath[];
  /** When `true`, runtime environment variables are not merged. */
  ignoreEnvVars?: boolean;
  /** Custom configuration factories, merged in order. */
  load?: ConfigFactory[];
  /** Validates (and optionally transforms) the merged configuration. */
  validate?: ConfigValidator;
}

/**
 * Options of {@link ConfigModule.forRootAsync}.
 */
export interface ConfigModuleAsyncOptions
  extends Pick<ModuleMetadata, "imports"> {
  /** When `true`, `ConfigService` is injectable without importing the module. */
  global?: boolean;
  /**
   * Factory that produces the module options.
   *
   * Injected values listed in {@link inject} are forwarded as positional
   * arguments.
   *
   * @return {Omit<ConfigModuleOptions, "global"> | Promise<Omit<ConfigModuleOptions, "global">>}
   *   Resolved module options (without `global`).
   */
  useFactory: GenericFunction<
    | Omit<ConfigModuleOptions, "global">
    | Promise<Omit<ConfigModuleOptions, "global">>
  >;
  /** Injection tokens passed as arguments to {@link useFactory}. */
  inject?: InjectionToken[];
  /** Additional providers registered alongside the config providers. */
  extraProviders?: Provider[];
}
