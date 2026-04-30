import {
  type DynamicModule,
  type FactoryProvider,
  Module,
  type ModuleRef,
  type OnModuleInit,
  type ValueProvider,
} from "@denorid/injector";
import { KV_MODULE_OPTIONS } from "./_constants.ts";
import { KvConnections } from "./connections.ts";
import type {
  KvAsyncModuleOptions,
  KvModuleOptions,
} from "./module_options.ts";
import { KvQueue, KvQueueListener } from "./queue/mod.ts";

/**
 * Denorid module that registers and manages Deno KV connections.
 * Use {@link KvModule.forRoot} or {@link KvModule.forRootAsync} to configure connections.
 */
@Module({
  providers: [KvConnections, KvQueueListener, KvQueue],
  exports: [KvConnections, KvQueue],
})
export class KvModule implements OnModuleInit {
  public constructor(private readonly moduleRef: ModuleRef) {}

  public async onModuleInit(): Promise<void> {
    const connections = await this.moduleRef.get(KvConnections);

    await connections.connect();
  }

  /**
   * Registers `KvModule` with a static configuration.
   *
   * @param {KvModuleOptions} options - The connection options.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRoot(options: KvModuleOptions): DynamicModule {
    return this.createDynamicModule({ useValue: options });
  }

  /**
   * Registers `KvModule` with an asynchronous factory configuration.
   *
   * @param {KvAsyncModuleOptions} options - The async connection options.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRootAsync(options: KvAsyncModuleOptions): DynamicModule {
    return this.createDynamicModule(
      {
        useFactory: options.useFactory,
        inject: options.inject,
      },
      options.imports,
    );
  }

  private static createDynamicModule(
    optionsProvider: Omit<ValueProvider | FactoryProvider, "provide">,
    imports?: DynamicModule["imports"],
  ): DynamicModule {
    return {
      module: KvModule,
      imports,
      providers: [
        {
          provide: KV_MODULE_OPTIONS,
          ...optionsProvider,
        } as ValueProvider | FactoryProvider,
      ],
    };
  }
}
