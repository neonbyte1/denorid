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
  RpcExecutionContext,
  RpcHostArguments,
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
 * Never settles: a message answered with it stays unacknowledged, so a
 * persistent store delivers it again after a restart.
 */
const UNACKNOWLEDGED: Promise<void> = Promise.withResolvers<void>().promise;

/**
 * Internal listener that discovers `@QueueHandler` classes on application bootstrap
 * and subscribes each to its respective KV queue.
 *
 * A failing handler is reported to the exception handler and its error is
 * rethrown, so the store redelivers the message according to the
 * `backoffSchedule` and finally writes it to the `keysIfUndelivered` keys.
 * A `ForbiddenException` (a denying guard or a handler rejecting the message)
 * is reported only: the message is acknowledged and not retried.
 *
 * Before application shutdown the listener stops dispatching and waits for
 * running handlers. Messages delivered after that stay unacknowledged. The
 * stores close later, when the injector disposes {@link KvConnections}.
 *
 * A failing queue subscription is logged, unless it fails because shutdown
 * closed the store.
 */
@Injectable()
export class KvQueueListener
  implements OnApplicationBootstrap, OnBeforeApplicationShutdown {
  private readonly logger = new Logger(KvQueueListener.name, {
    timestamp: false,
  });

  @Inject(ExceptionHandler)
  private readonly exceptionHandler!: ExceptionHandler;

  private closing = false;

  private readonly running: Set<Promise<void>> = new Set();

  public constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * @inheritdoc
   */
  public onApplicationBootstrap(): Promise<void> {
    return this.discoverHandlers();
  }

  /**
   * Stops dispatching queue messages and waits for the running handlers.
   *
   * @param {string} [_signal] - The shutdown signal, unused.
   * @return {Promise<void>} Resolves once no handler runs anymore.
   */
  public async onBeforeApplicationShutdown(_signal?: string): Promise<void> {
    this.closing = true;

    await Promise.all(this.running);
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

      kv.listenQueue((msg: unknown) => this.dispatch(ctx, msg, queueMetadata))
        .catch((err: unknown) => this.handleListenFailure(key, err));
    }
  }

  private handleListenFailure(queue: string, err: unknown): void {
    if (this.closing) {
      return;
    }

    const message = `Queue listener for "${queue}" failed`;

    if (err instanceof Error) {
      this.logger.error(`${message}: ${err.message}`, err.stack);
    } else {
      this.logger.error(`${message}: ${String(err)}`);
    }
  }

  private async dispatch(
    ctx: InjectorContext,
    msg: unknown,
    queueMetadata: Array<InstanceMessageMetadata>,
  ): Promise<void> {
    if (this.closing) {
      return await UNACKNOWLEDGED;
    }

    const { promise, resolve } = Promise.withResolvers<void>();

    this.running.add(promise);

    try {
      await this.handleMessage(ctx, msg, queueMetadata);
    } finally {
      this.running.delete(promise);
      resolve();
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

    const found = this.findHandler(msg.id, queueMetadata);

    if (!found) {
      this.logger.warn(`Received unhandled event ${msg.id}`);

      return;
    }

    const [metadata, match] = found;
    const contextId = crypto.randomUUID();

    await ctx.runInRequestScopeAsync(contextId, async () => {
      try {
        const payload = this.getPayloadFromMessage(msg, metadata);
        const instance = await this.moduleRef.get(metadata.handler, {
          contextId,
          strict: false,
        });

        const allGuards = [
          ...metadata.controllerGuards,
          ...metadata.methodGuards,
        ];

        if (allGuards.length > 0) {
          const executionCtx = new RpcExecutionContext(
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
                strict: false,
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

        await instance[metadata.method](payload, match);
      } catch (err) {
        await this.exceptionHandler.handle(
          err,
          new RpcHostArguments(msg.id, msg.payload),
        );

        // A ForbiddenException rejects the message for good, a redelivery
        // would be rejected again.
        if (!(err instanceof ForbiddenException)) {
          throw err;
        }
      }
    });
  }

  private findHandler(
    id: string,
    queueMetadata: Array<InstanceMessageMetadata>,
  ): [InstanceMessageMetadata, RegExpMatchArray | undefined] | undefined {
    for (const metadata of queueMetadata) {
      if (typeof metadata.event === "string") {
        if (metadata.event === id) {
          return [metadata, undefined];
        }

        continue;
      }

      // Global and sticky patterns start at `lastIndex`, which a previous
      // message may have moved.
      metadata.event.lastIndex = 0;

      const match = metadata.event.exec(id);

      if (match) {
        return [metadata, match];
      }
    }

    return undefined;
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
        const queue = metadata.name ?? queueName;

        if (connections.connections.get(queue)?.queue !== true) {
          continue;
        }

        const cache = data[queue] ??= [];

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
