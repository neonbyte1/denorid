import { type ClientProxy, Transport } from "@denorid/core/microservices";
import {
  type DynamicModule,
  type FactoryProvider,
  type InjectionToken,
  Module,
} from "@denorid/injector";
import { RmqClient } from "./rmq/client.ts";
import type { RmqOptions } from "./rmq/options.ts";
import { TcpClient } from "./tcp/client.ts";
import type { TcpOptions } from "./tcp/options.ts";

/**
 * A single named client registration entry for {@link ClientsModule.register}.
 */
export interface ClientRegistrationEntry {
  /** The DI injection token under which the client proxy will be provided. */
  name: InjectionToken;
  /** The transport to use for this client. */
  transport: Transport;
  /** Transport-specific connection options. */
  options?: TcpOptions | RmqOptions;
}

/**
 * Module that registers named {@link ClientProxy} instances into the DI container.
 *
 * Use {@link register} to provide one or more clients injectable via `@Inject(name)`.
 *
 * @example
 * ```ts
 * \@Module({
 *   imports: [
 *     ClientsModule.register([
 *       { name: "USER_SERVICE", transport: Transport.TCP, options: { port: 3001 } },
 *     ]),
 *   ],
 * })
 * class AppModule {}
 * ```
 */
@Module({})
export class ClientsModule {
  /**
   * Registers a set of named client proxies as DI providers.
   *
   * Each client's `connect()` is called eagerly during module initialisation
   * so connection failures surface at bootstrap time.
   *
   * @param {ClientRegistrationEntry[]} entries - The clients to register.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static register(entries: ClientRegistrationEntry[]): DynamicModule {
    const providers: FactoryProvider[] = entries.map(
      (entry): FactoryProvider => ({
        provide: entry.name,
        useFactory: async (): Promise<ClientProxy> => {
          const client: ClientProxy = entry.transport === Transport.TCP
            ? new TcpClient((entry.options as TcpOptions | undefined) ?? {})
            : new RmqClient((entry.options as RmqOptions | undefined) ?? {});

          await client.connect();

          return client;
        },
      }),
    );

    return {
      module: ClientsModule,
      providers,
      exports: entries.map((e) => e.name),
    };
  }
}
