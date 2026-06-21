import {
  type DynamicModule,
  type FactoryProvider,
  Module,
  type ValueProvider,
} from "@denorid/injector";
import { S3_MODULE_OPTIONS } from "./_constants.ts";
import { StorageConnections } from "./connections.ts";
import type {
  S3AsyncModuleOptions,
  S3ModuleOptions,
} from "./module_options.ts";

/**
 * Denorid module that registers one or more {@link StorageClient} instances
 * backed by `@aws-sdk/client-s3`.
 *
 * Use {@link S3Module.forRoot} for static configuration or
 * {@link S3Module.forRootAsync} when the SDK config must be resolved from
 * injected providers (e.g. a config service that loads credentials at
 * startup). Connections are reached through the {@link StorageConnections}
 * service or the `InjectStorage(name?)` helper - the same service owns
 * lifecycle and tears every client down on application shutdown.
 *
 * Each `S3Module` registration is the single source of truth: declare
 * every connection up front in `connections: [...]` (or pass a single
 * default-named one via `connection: { ... }`). The injector instantiates
 * the module class once per type, so calling `forRoot` twice would silently
 * drop the second registration.
 *
 * @example Single default connection
 * ```ts
 * \@Module({
 *   imports: [
 *     S3Module.forRoot({
 *       connection: {
 *         region: "eu-central-1",
 *         credentials: { accessKeyId: "...", secretAccessKey: "..." },
 *       },
 *     }),
 *   ],
 * })
 * class AppModule {}
 * ```
 *
 * @example Multiple named connections
 * ```ts
 * S3Module.forRoot({
 *   connections: [
 *     { name: "primary", region: "us-east-1", credentials: prodCreds },
 *     { name: "backup",  region: "eu-central-1", credentials: prodCreds },
 *     {
 *       name: "minio",
 *       region: "us-east-1",
 *       endpoint: "http://127.0.0.1:9000",
 *       credentials: { accessKeyId: "minio", secretAccessKey: "minio123" },
 *       forcePathStyle: true,
 *     },
 *   ],
 * });
 * ```
 *
 * @example Async registration backed by a config service
 * ```ts
 * S3Module.forRootAsync({
 *   imports: [ConfigModule],
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({
 *     connections: [
 *       { name: "primary", region: config.get("AWS_PRIMARY_REGION") },
 *       { name: "backup",  region: config.get("AWS_BACKUP_REGION") },
 *     ],
 *   }),
 * });
 * ```
 */
@Module({
  providers: [StorageConnections],
  exports: [StorageConnections],
})
export class S3Module {
  /**
   * Registers `S3Module` with static options.
   *
   * @param {S3ModuleOptions} options - Single (`connection`) or multi
   *   (`connections`) SDK configuration.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRoot(options: S3ModuleOptions): DynamicModule {
    return this.createDynamicModule(options, { useValue: options });
  }

  /**
   * Registers `S3Module` with options resolved via an async factory.
   *
   * @param {S3AsyncModuleOptions} options - Async configuration carrying
   *   `useFactory`, `inject`, optional `imports`, and `extraProviders`.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRootAsync(options: S3AsyncModuleOptions): DynamicModule {
    return this.createDynamicModule(options, {
      useFactory: options.useFactory,
      inject: options.inject,
    });
  }

  private static createDynamicModule(
    options: S3ModuleOptions | S3AsyncModuleOptions,
    optionsProviderData: Omit<ValueProvider | FactoryProvider, "provide">,
  ): DynamicModule {
    return {
      module: S3Module,
      global: options.global,
      imports: (options as S3AsyncModuleOptions).imports ?? [],
      providers: [
        {
          provide: S3_MODULE_OPTIONS,
          ...optionsProviderData,
        } as ValueProvider | FactoryProvider,
        ...((options as S3AsyncModuleOptions).extraProviders ?? []),
      ],
    };
  }
}
