import {
  type CanActivate,
  type CanActivateFn,
  ExceptionHandler,
  ForbiddenException,
  getMethodGuards,
  GUARDS_METADATA,
  type HttpRouteFn,
  isClass,
  isFunction,
  RcpExecutionContext,
  RcpHostArguments,
} from "@denorid/core";
import {
  Inject,
  Injectable,
  InjectorContext,
  type ModuleRef,
  type OnApplicationBootstrap,
  type OnBeforeApplicationShutdown,
  type Type,
} from "@denorid/injector";
import { Logger } from "@denorid/logger";
import { QUEUE_HANDLER, QUEUE_HANDLER_METADATA } from "../_constants.ts";
import { KvConnections } from "../connections.ts";
import type { MessageMetadata } from "./_metadata.ts";
import type { KvQueueMessage } from "./queue.ts";

type Instance = Record<
  string | symbol,
  (payload?: object, match?: RegExpMatchArray) => void | Promise<void>
>;

type InstanceMessageMetadata = MessageMetadata & {
  handler: Type<Instance>;
  controllerGuards: (Type<CanActivate> | CanActivate | CanActivateFn)[];
  methodGuards: (Type<CanActivate> | CanActivate | CanActivateFn)[];
};

/**
 * Internal listener that discovers `@QueueHandler` classes on application bootstrap
 * and subscribes each to its respective Deno KV queue.
 * Closes all connections before application shutdown.
 */
@Injectable()
export class KvQueueListener
  implements OnApplicationBootstrap, OnBeforeApplicationShutdown {
  private readonly logger = new Logger(KvQueueListener.name, {
    timestamp: false,
  });

  @Inject(ExceptionHandler)
  private readonly exceptionHandler!: ExceptionHandler;

  public constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * @inheritdoc
   */
  public onApplicationBootstrap(): Promise<void> {
    return this.discoverHandlers();
  }

  /**
   * @inheritdoc
   */
  public async onBeforeApplicationShutdown(_signal?: string): Promise<void> {
    const connections = await this.moduleRef.get(KvConnections);

    connections.close();
  }

  private async discoverHandlers(): Promise<void> {
    const [connections, queueData] = await this.resolveQueueBindings();

    if (queueData === null) {
      return;
    }

    const ctx = await this.moduleRef.get(InjectorContext, {
      strict: false,
    });

    for (const key of Object.keys(queueData)) {
      const kv = connections.get(key);
      const queueMetadata = queueData[key];

      kv.listenQueue((msg: unknown) => {
        return this.handleMessage(ctx, msg, queueMetadata);
      });
    }
  }

  private async handleMessage(
    ctx: InjectorContext,
    msg: unknown,
    queueMetadata: Array<InstanceMessageMetadata>,
  ): Promise<void> {
    if (!this.isQueueMessage(msg)) {
      return;
    }

    const metadata = queueMetadata.find((m: InstanceMessageMetadata) =>
      m.event instanceof RegExp ? m.event.test(msg.id) : m.event === msg.id
    );

    if (!metadata) {
      this.logger.warn(`Received unhandled event ${msg.id}`);

      return;
    }

    const payload = this.getPayloadFromMessage(msg, metadata);
    const contextId = crypto.randomUUID();

    await ctx.runInRequestScopeAsync(contextId, async () => {
      try {
        const instance = await this.moduleRef.get(metadata.handler, {
          contextId,
          strict: false,
        });

        const allGuards = [
          ...metadata.controllerGuards,
          ...metadata.methodGuards,
        ];

        if (allGuards.length > 0) {
          const executionCtx = new RcpExecutionContext(
            msg.id,
            msg.payload,
            metadata.handler,
            instance[metadata.method] as unknown as HttpRouteFn,
          );

          for (const guard of allGuards) {
            let allowed: boolean;

            if (isClass<CanActivate>(guard)) {
              const guardInstance = await this.moduleRef.get(guard, {
                contextId,
              });
              allowed = await (guardInstance as CanActivate).canActivate(
                executionCtx,
              );
            } else if (isFunction<CanActivateFn>(guard)) {
              allowed = await guard(executionCtx);
            } else {
              allowed = await guard.canActivate(executionCtx);
            }

            if (!allowed) {
              throw new ForbiddenException();
            }
          }
        }

        await instance[metadata.method](
          payload,
          metadata.event instanceof RegExp
            ? metadata.event.exec(msg.id)!
            : undefined,
        );
      } catch (err) {
        await this.exceptionHandler.handle(
          err,
          new RcpHostArguments(msg.id, msg.payload),
        );
      }
    });
  }

  private getPayloadFromMessage(
    { payload }: KvQueueMessage,
    metadata: MessageMetadata,
  ): object | undefined {
    if (payload && metadata.dto) {
      const dto = new metadata.dto() as object;

      Object.assign(dto, payload);

      return dto;
    }

    return payload;
  }

  private isQueueMessage(msg: unknown): msg is KvQueueMessage {
    return typeof msg === "object" &&
      msg !== null &&
      typeof (msg as KvQueueMessage).id === "string";
  }

  private async resolveQueueBindings(): Promise<[
    KvConnections,
    Record<string, Array<InstanceMessageMetadata>> | null,
  ]> {
    const connections = await this.moduleRef.get(KvConnections);
    const handlers = this.moduleRef.getTokensByTag<Type>(QUEUE_HANDLER, {
      strict: false,
    });
    const handlerMap = this.resolveHandlerMap(connections, handlers);

    return [
      connections,
      Object.keys(handlerMap).length > 0 ? handlerMap : null,
    ];
  }

  private resolveHandlerMap(
    connections: KvConnections,
    handlers: Type[],
  ): Record<string, Array<InstanceMessageMetadata>> {
    const data: Record<string, Array<InstanceMessageMetadata>> = {};

    for (const handler of handlers) {
      const queueName = handler[Symbol.metadata]![QUEUE_HANDLER] as string;
      const entry = connections.connections.get(queueName);

      if (!entry || !entry.queue) {
        continue;
      }

      const messageMetadata =
        handler[Symbol.metadata]![QUEUE_HANDLER_METADATA] as
          | MessageMetadata[]
          | undefined;

      if (!messageMetadata) {
        continue;
      }

      const controllerGuards = [
        ...(handler[Symbol.metadata]![GUARDS_METADATA] as
          | Set<Type<CanActivate> | CanActivate | CanActivateFn>
          | undefined ?? new Set()),
      ];

      for (const metadata of messageMetadata) {
        const cache = (data[metadata.name ?? queueName] ??= []) as Array<
          InstanceMessageMetadata
        >;

        const methodGuards = [
          ...(getMethodGuards(handler, metadata.method) ?? new Set()),
        ];

        cache.push({
          ...metadata,
          handler: handler as Type<Instance>,
          controllerGuards,
          methodGuards,
        });
      }
    }

    return data;
  }
}
