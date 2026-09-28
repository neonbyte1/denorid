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
 * asynchronously - e.g. fetched from a config service or environment at startup.
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
 * Every registration gets its own `JwtService` and `JwkService` configured
 * with its own options, so modules can register the JWT module with
 * different keys (e.g. one for signing, one for verifying).
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
 *   useFactory: (config: ConfigService) => ({
 *     secret: config.getOrThrow<string>("JWT_SECRET"),
 *   }),
 * })
 * ```
 */
@Module({
  providers: [JwkService, JwtService],
  exports: [JwkService, JwtService],
})
export class JwtModule {
  /**
   * Registers the JWT module with static options. The returned module has
   * its own `JwtService`: import the same returned module to share it.
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
   * Registers the JWT module with async options resolved via a factory. The
   * returned module has its own `JwtService`: import the same returned
   * module to share it.
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
    // The injector keeps one container per module class, so registrations
    // sharing `JwtModule` would share the providers of the first one. A
    // subclass per registration inherits the `@Module()` metadata and gets
    // its own container.
    const module = class extends JwtModule {};

    Object.defineProperty(module, "name", { value: JwtModule.name });

    return {
      module,
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
