import {
  type DynamicModule,
  type ExistingProvider,
  type FactoryProvider,
  Module,
  type ModuleRef,
  type OnModuleDestroy,
  type OnModuleInit,
  type ValueProvider,
} from "@denorid/injector";
import { AMQP_MODULE_OPTIONS, AMQP_SERIALIZER } from "./_constants.ts";
import { AmqpExplorer } from "./_explorer.ts";
import {
  type AbstractClient,
  PublisherClient,
  RoutingClient,
  RpcClient,
  TopicClient,
  WorkerClient,
} from "./clients.ts";
import { AmqpConnection } from "./connection.ts";
import type {
  AmqpAsyncModuleOptions,
  AmqpModuleOptions,
} from "./module_options.ts";
import type {
  AmqpClientRegistration,
  ExchangeClientOptions,
  RpcClientOptions,
  WorkerClientOptions,
} from "./options.ts";
import { type AmqpSerializer, JsonAmqpSerializer } from "./serialization.ts";

/**
 * Denorid module that provides the shared AMQP broker connection and the
 * consumer explorer.
 *
 * Use {@link AmqpModule.forRoot} for static options or
 * {@link AmqpModule.forRootAsync} to resolve options from injected providers.
 * The shared connection is exported under {@link AmqpConnection} and is closed
 * on module destruction.
 *
 * @example Synchronous registration
 * ```ts
 * \@Module({ imports: [AmqpModule.forRoot({ url: "amqp://localhost" })] })
 * class AppModule {}
 * ```
 *
 * @example Async registration backed by a config service
 * ```ts
 * AmqpModule.forRootAsync({
 *   imports: [ConfigModule],
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({ url: config.get("AMQP_URL") }),
 * });
 * ```
 */
@Module({
  providers: [AmqpConnection, AmqpExplorer],
  exports: [AmqpConnection],
})
export class AmqpModule implements OnModuleInit, OnModuleDestroy {
  public constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * @inheritdoc
   */
  public async onModuleInit(): Promise<void> {
    // Eager-resolve so onModuleDestroy always has a live connection to close.
    await this.moduleRef.get(AmqpConnection);
  }

  /**
   * @inheritdoc
   */
  public async onModuleDestroy(): Promise<void> {
    const connection = await this.moduleRef.get(AmqpConnection);

    await connection.close();
  }

  /**
   * Registers `AmqpModule` with static options.
   *
   * @param {AmqpModuleOptions} [options] - Module configuration. Defaults to an
   *   empty options object (broker URL "amqp://localhost").
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRoot(options: AmqpModuleOptions = {}): DynamicModule {
    return this.createDynamicModule(options, { useValue: options });
  }

  /**
   * Registers `AmqpModule` with options resolved via an async factory.
   *
   * @param {AmqpAsyncModuleOptions} options - Async module configuration.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRootAsync(options: AmqpAsyncModuleOptions): DynamicModule {
    return this.createDynamicModule(options, {
      useFactory: options.useFactory,
      inject: options.inject,
    });
  }

  private static createDynamicModule(
    options: AmqpModuleOptions | AmqpAsyncModuleOptions,
    optionsProviderData: Omit<ValueProvider | FactoryProvider, "provide">,
  ): DynamicModule {
    const clients = (options as AmqpModuleOptions).clients ?? [];

    return {
      module: AmqpModule,
      global: options.global,
      imports: (options as AmqpAsyncModuleOptions).imports ?? [],
      providers: [
        {
          provide: AMQP_MODULE_OPTIONS,
          ...optionsProviderData,
        } as ValueProvider | FactoryProvider,
        this.createSerializerProvider(options),
        ...clients.map((client) => this.createClientProvider(client)),
        // Registered last so a user-supplied AMQP_SERIALIZER provider wins.
        ...(options.extraProviders ?? []),
      ],
      exports: clients.map((client) => client.name),
    };
  }

  /**
   * Builds the provider that constructs a sender client from the shared
   * {@link AmqpConnection} and exposes it under its registration `name`.
   *
   * @param {AmqpClientRegistration} client - The client registration.
   * @return {FactoryProvider} The client factory provider.
   */
  private static createClientProvider(
    client: AmqpClientRegistration,
  ): FactoryProvider {
    return {
      provide: client.name,
      useFactory: (connection: AmqpConnection): AbstractClient<unknown> => {
        switch (client.type) {
          case "worker":
            return new WorkerClient(connection, client as WorkerClientOptions);
          case "pub-sub":
            return new PublisherClient(
              connection,
              client as ExchangeClientOptions,
            );
          case "routing":
            return new RoutingClient(
              connection,
              client as ExchangeClientOptions,
            );
          case "topic":
            return new TopicClient(connection, client as ExchangeClientOptions);
          case "rpc":
            return new RpcClient(connection, client as RpcClientOptions);
        }
      },
      inject: [AmqpConnection],
    };
  }

  /**
   * Builds the provider for the `AMQP_SERIALIZER` token.
   *
   * For a statically-known class serializer (`forRoot`), aliases the token to
   * the class via `useExisting` - the class must be registered in
   * `extraProviders` so the container builds it (with its injected
   * dependencies). Otherwise a factory reads the resolved options and uses the
   * instance, the default JSON serializer, or - for a class arriving through
   * `forRootAsync` - throws guiding the user to register an `AMQP_SERIALIZER`
   * provider in `extraProviders`.
   *
   * @param {AmqpModuleOptions | AmqpAsyncModuleOptions} options - Module config.
   * @return {ExistingProvider | FactoryProvider} The serializer provider.
   */
  private static createSerializerProvider(
    options: AmqpModuleOptions | AmqpAsyncModuleOptions,
  ): ExistingProvider | FactoryProvider {
    const serializer = (options as AmqpModuleOptions).serializer;

    if (typeof serializer === "function") {
      return { provide: AMQP_SERIALIZER, useExisting: serializer };
    }

    return {
      provide: AMQP_SERIALIZER,
      useFactory: (opts: AmqpModuleOptions): AmqpSerializer => {
        if (typeof opts.serializer === "function") {
          throw new Error(
            "A class serializer must be registered in AmqpModuleOptions." +
              "extraProviders as a provider for the AMQP_SERIALIZER token.",
          );
        }

        return opts.serializer ?? new JsonAmqpSerializer();
      },
      inject: [AMQP_MODULE_OPTIONS],
    };
  }
}
