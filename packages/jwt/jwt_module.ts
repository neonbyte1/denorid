import {
  type DynamicModule,
  type FactoryProvider,
  type InjectionToken,
  Module,
  type ModuleMetadata,
  type Provider,
  type ValueProvider,
} from "@denorid/injector";
import { JWT_MODULE_OPTIONS } from "./_constants.ts";
import type { JwtModuleOptions } from "./common.ts";
import { JwkService } from "./jwk_service.ts";
import { JwtService } from "./jwt_service.ts";

/**
 * Async configuration options for {@link JwtModule}.
 *
 * Use this interface with {@link JwtModule.forRootAsync} when module options must be resolved
 * asynchronously — e.g. fetched from a config service or environment at startup.
 */
export interface JwtModuleAsyncOptions extends Pick<ModuleMetadata, "imports"> {
  /** When `true`, registers the JWT module as a global provider. */
  global?: boolean;
  /**
   * Factory function that produces the module options.
   *
   * Injected values listed in {@link inject} are forwarded as positional arguments.
   *
   * @param args - Resolved injection tokens declared in {@link inject}.
   * @return {JwtModuleOptions | Promise<JwtModuleOptions>} Resolved module options (without `global`).
   */
  useFactory: (
    // deno-lint-ignore no-explicit-any
    ...args: any[]
  ) =>
    | Omit<JwtModuleOptions, "global">
    | Promise<Omit<JwtModuleOptions, "global">>;
  /** Injection tokens passed as arguments to {@link useFactory}. */
  inject?: InjectionToken[];
  /** Additional providers registered alongside the JWT providers. */
  extraProviders?: Provider[];
}

/**
 * Module that wires up {@link JwtService} and {@link JwkService} for dependency injection.
 *
 * Register synchronously via {@link forRoot} when options are available at module definition time,
 * or asynchronously via {@link forRootAsync} when they depend on injected providers.
 *
 * @example Synchronous registration
 * ```ts
 * JwtModule.forRoot({ secret: "my-secret", signOptions: { exp: "1h" } })
 * ```
 *
 * @example Async registration with a config service
 * ```ts
 * JwtModule.forRootAsync({
 *   imports: [ConfigModule],
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({ secret: config.get("JWT_SECRET") }),
 * })
 * ```
 */
@Module({
  providers: [JwkService, JwtService],
  exports: [JwkService, JwtService],
})
export class JwtModule {
  /**
   * Registers the JWT module with static options.
   *
   * @param {JwtModuleOptions} options - Module configuration.
   * @return {DynamicModule} Configured dynamic module.
   */
  public static forRoot(options: JwtModuleOptions): DynamicModule {
    return this.createDynamicModule(options, {
      useValue: options,
    });
  }

  /**
   * Registers the JWT module with async options resolved via a factory.
   *
   * @param {JwtModuleAsyncOptions} options - Async module configuration.
   * @return {DynamicModule} Configured dynamic module.
   */
  public static forRootAsync(options: JwtModuleAsyncOptions): DynamicModule {
    return this.createDynamicModule(options, {
      useFactory: options.useFactory,
      inject: options.inject,
    });
  }

  private static createDynamicModule(
    options: JwtModuleOptions | JwtModuleAsyncOptions,
    providerData: Omit<ValueProvider | FactoryProvider, "provide">,
  ): DynamicModule {
    return {
      module: JwtModule,
      global: options.global,
      imports: (options as JwtModuleAsyncOptions).imports ?? [],
      providers: [
        {
          provide: JWT_MODULE_OPTIONS,
          ...providerData,
        } as ValueProvider | FactoryProvider,
        ...((options as JwtModuleAsyncOptions).extraProviders ?? []),
      ],
    };
  }
}
