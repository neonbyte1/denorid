<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  Configuration module for Denorid - loads YAML files, <code>.env</code> files,
  custom factories and environment variables into a typed <code>ConfigService</code>.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/config">
    <img src="https://jsr.io/badges/@denorid/config" alt="Denorid config version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/config
```

## Quick Start

### Defaults

Importing the module as is loads `.env` from the working directory (when
present) plus the runtime environment variables.

```ts
@Module({ imports: [ConfigModule] })
export class AppModule {}
```

### YAML files

```ts
@Module({
  imports: [
    ConfigModule.forRoot({
      global: true,
      yamlFilePath: ["config.yaml", "config.local.yaml"],
    }),
  ],
})
export class AppModule {}
```

```yaml
# config.yaml
database:
  host: localhost
  port: 5432
```

Paths are resolved against the working directory. Pass a `URL` for files next to
your module: `new URL("./config.yaml", import.meta.url)`.

### Async options

```ts
@Module({
  imports: [
    ConfigModule.forRootAsync({
      imports: [SecretsModule],
      inject: [SecretsService],
      useFactory: (secrets: SecretsService) => ({
        yamlFilePath: "config.yaml",
        load: [() => secrets.fetchAll()],
      }),
    }),
  ],
})
export class AppModule {}
```

## Reading values

```ts
interface AppConfig {
  PORT: string;
  database: { host: string; port: number };
}

@Injectable()
export class DatabaseService {
  @Inject(ConfigService)
  private readonly config!: ConfigService<AppConfig>;

  public url(): string {
    const host = this.config.getOrThrow("database.host"); // string
    const port = this.config.get("database.port", 5432); // number

    return `postgres://${host}:${port}`;
  }
}
```

- `get(path)` returns `undefined` for missing keys, `get(path, fallback)` the
  fallback.
- `getOrThrow(path)` throws `ConfigKeyNotFoundError` for missing keys.
- Without a type argument (`ConfigService`) any path is accepted; pass the value
  type explicitly: `config.get<string>("PORT")`.

## Options

| Option          | Default  | Description                                                        |
| --------------- | -------- | ------------------------------------------------------------------ |
| `global`        | `false`  | Makes `ConfigService` injectable without importing the module.     |
| `yamlFilePath`  | none     | YAML file(s), each with a mapping at the top level.                |
| `envFilePath`   | `".env"` | `.env` file(s). Pass `[]` to load none.                            |
| `ignoreEnvVars` | `false`  | Skips the runtime environment variables.                           |
| `load`          | none     | Factories receiving the environment variables, returning config.   |
| `validate`      | none     | Receives the merged config; its return value is what gets exposed. |

Sources are merged in this order, later ones win: `yamlFilePath`, `load`,
`envFilePath`, runtime environment variables. Objects are merged deeply, any
other value (including arrays) is replaced. Missing files are skipped.

Merging the runtime environment variables enumerates the whole environment,
which on Deno requires unscoped `--allow-env`. With a scoped flag such as
`--allow-env=PORT`, loading throws `NotCapable`; set `ignoreEnvVars: true` and
read the allowed variables in a `load` factory instead:

```ts
ConfigModule.forRoot({
  ignoreEnvVars: true,
  load: [() => ({ PORT: process.env.PORT })],
});
```

Validation works with any schema library, e.g. zod:

```ts
const schema = z.object({ PORT: z.coerce.number().default(8080) });

ConfigModule.forRoot({ validate: (config) => schema.parse(config) });
```

## Import order

Feature modules may import plain `ConfigModule` to reach the configuration of
`forRoot` in any order, global or not. The provider order inside modules does
not matter either.

`forRootAsync` must be listed before every module that imports plain
`ConfigModule`, otherwise resolving `ConfigService` throws a
`ConfigModuleImportOrderError`. With `global: true` the order does not matter.

## License

The [@denorid/config](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
