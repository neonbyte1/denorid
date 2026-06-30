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
import type { Channel, ConsumeMessage, MessageProperties } from "amqplib";
import {
  AMQP_CONSUMER,
  AMQP_MODULE_OPTIONS,
  AMQP_SERIALIZER,
} from "./_constants.ts";
import { type AmqpBinding, getAmqpBindings } from "./_metadata.ts";
import { AmqpConnection } from "./connection.ts";
import { AmqpExecutionContext, AmqpHostArguments } from "./host_arguments.ts";
import type { AmqpModuleOptions } from "./module_options.ts";
import type {
  PubSubOptions,
  RoutingOptions,
  RpcOptions,
  TopicOptions,
  WorkerOptions,
} from "./options.ts";
import type { AmqpSerializer } from "./serialization.ts";

/** A consumer instance addressed by handler method name. */
type ConsumerInstance = Record<
  string | symbol,
  (payload: unknown, properties: MessageProperties) => unknown
>;

/** Guards applicable to a handler, in evaluation order. */
type Guard = Type<CanActivate> | CanActivate | CanActivateFn;

/**
 * Internal consumer runtime. On application bootstrap it discovers
 * `@AmqpConsumer` classes, asserts each binding's topology against the broker,
 * consumes its queue, and dispatches messages to the decorated methods with
 * guard and `ExceptionHandler` integration. Closes every consumer channel
 * before application shutdown.
 */
@Injectable()
export class AmqpExplorer
  implements OnApplicationBootstrap, OnBeforeApplicationShutdown {
  private readonly logger = new Logger(AmqpExplorer.name, { timestamp: true });

  @Inject(ExceptionHandler)
  private readonly exceptionHandler!: ExceptionHandler;

  @Inject(AMQP_MODULE_OPTIONS)
  private readonly options!: AmqpModuleOptions;

  @Inject(AMQP_SERIALIZER)
  private readonly serializer!: AmqpSerializer;

  private readonly channels: Channel[] = [];

  public constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * @inheritdoc
   */
  public onApplicationBootstrap(): Promise<void> {
    return this.discover();
  }

  /**
   * @inheritdoc
   */
  public async onBeforeApplicationShutdown(): Promise<void> {
    for (const channel of this.channels) {
      try {
        await channel.close();
        // deno-lint-ignore no-empty
      } catch {}
    }

    this.channels.length = 0;
  }

  private async discover(): Promise<void> {
    const consumers = this.moduleRef.getTokensByTag<Type>(AMQP_CONSUMER, {
      strict: false,
    });

    if (consumers.length === 0) {
      return;
    }

    const connection = await this.moduleRef.get(AmqpConnection);
    const ctx = await this.moduleRef.get(InjectorContext, { strict: false });

    for (const consumer of consumers) {
      const bindings = getAmqpBindings(consumer);

      if (!bindings?.length) {
        continue;
      }

      const controllerGuards = [
        ...(consumer[Symbol.metadata]![GUARDS_METADATA] as
          | Set<Guard>
          | undefined ?? new Set<Guard>()),
      ];

      for (const binding of bindings) {
        const methodGuards = [
          ...(getMethodGuards(consumer, binding.method) ?? new Set<Guard>()),
        ];
        const channel = await connection.createChannel();

        this.channels.push(channel);

        await this.bind(
          channel,
          ctx,
          consumer,
          binding,
          controllerGuards,
          methodGuards,
        );
      }
    }
  }

  private async bind(
    channel: Channel,
    ctx: InjectorContext,
    consumer: Type,
    binding: AmqpBinding,
    controllerGuards: Guard[],
    methodGuards: Guard[],
  ): Promise<void> {
    const queueName = await this.assertTopology(channel, binding);

    await channel.consume(
      queueName,
      (msg) => {
        if (msg !== null) {
          this.handle(
            channel,
            ctx,
            msg,
            binding,
            consumer,
            controllerGuards,
            methodGuards,
          ).catch((err) => {
            this.logger.error(
              "Unhandled error in AMQP message handler",
              err,
            );
          });
        }
      },
      { noAck: false },
    );
  }

  private async assertTopology(
    channel: Channel,
    binding: AmqpBinding,
  ): Promise<string> {
    switch (binding.type) {
      case "worker": {
        // Narrowed by the `binding.type` discriminant; the union cannot unify.
        const o = binding.options as WorkerOptions;

        await channel.assertQueue(o.queue, { durable: o.durable ?? true });
        await channel.prefetch(o.prefetch ?? 1);

        return o.queue;
      }
      case "pub-sub": {
        // Narrowed by the `binding.type` discriminant; the union cannot unify.
        const o = binding.options as PubSubOptions;

        await channel.assertExchange(o.exchange, "fanout", {
          durable: o.durable ?? true,
        });

        const queue = await this.assertBoundQueue(channel, o.queue);

        await channel.bindQueue(queue, o.exchange, "");

        return queue;
      }
      case "routing": {
        // Narrowed by the `binding.type` discriminant; the union cannot unify.
        const o = binding.options as RoutingOptions;

        await channel.assertExchange(o.exchange, "direct", {
          durable: o.durable ?? true,
        });

        const queue = await this.assertBoundQueue(channel, o.queue);

        for (const key of o.routingKeys) {
          await channel.bindQueue(queue, o.exchange, key);
        }

        return queue;
      }
      case "topic": {
        // Narrowed by the `binding.type` discriminant; the union cannot unify.
        const o = binding.options as TopicOptions;

        await channel.assertExchange(o.exchange, "topic", {
          durable: o.durable ?? true,
        });

        const queue = await this.assertBoundQueue(channel, o.queue);

        for (const pattern of o.routingKeys) {
          await channel.bindQueue(queue, o.exchange, pattern);
        }

        return queue;
      }
      case "rpc": {
        // Narrowed by the `binding.type` discriminant; the union cannot unify.
        const o = binding.options as RpcOptions;

        await channel.assertQueue(o.queue, { durable: false });
        await channel.prefetch(o.prefetch ?? 1);

        return o.queue;
      }
    }
  }

  private async assertBoundQueue(
    channel: Channel,
    queue: string | undefined,
  ): Promise<string> {
    const response = await channel.assertQueue(queue ?? "", {
      exclusive: !queue,
      durable: !!queue,
      autoDelete: !queue,
    });

    return response.queue;
  }

  private async handle(
    channel: Channel,
    ctx: InjectorContext,
    msg: ConsumeMessage,
    binding: AmqpBinding,
    consumer: Type,
    controllerGuards: Guard[],
    methodGuards: Guard[],
  ): Promise<void> {
    const payload = this.serializer.deserialize(msg.content);
    const pattern = msg.fields.routingKey || msg.fields.exchange;
    const contextId = crypto.randomUUID();
    const replyTo: string | undefined = msg.properties.replyTo;
    const correlationId: string | undefined = msg.properties.correlationId;

    await ctx.runInRequestScopeAsync(contextId, async () => {
      try {
        // The DI container resolves the consumer class to its instance shape.
        const instance = await this.moduleRef.get(consumer, {
          contextId,
          strict: false,
        }) as ConsumerInstance;

        await this.runGuards(
          contextId,
          pattern,
          payload,
          consumer,
          instance[binding.method],
          controllerGuards,
          methodGuards,
        );

        const result = await instance[binding.method](payload, msg.properties);

        if (binding.type === "rpc" && replyTo) {
          channel.sendToQueue(replyTo, this.serializer.serialize(result), {
            correlationId,
          });
        }

        channel.ack(msg);
      } catch (err) {
        await this.exceptionHandler.handle(
          err,
          new AmqpHostArguments(pattern, payload),
        );

        if (binding.type === "rpc" && replyTo) {
          channel.sendToQueue(
            replyTo,
            this.serializer.serialize({ err: String(err) }),
            {
              correlationId,
            },
          );
        }

        channel.nack(msg, false, false);
      }
    });
  }

  private async runGuards(
    contextId: string,
    pattern: string,
    payload: unknown,
    consumer: Type,
    handlerFn: ConsumerInstance[string | symbol],
    controllerGuards: Guard[],
    methodGuards: Guard[],
  ): Promise<void> {
    const allGuards = [
      ...(this.options.globalGuards ?? []),
      ...controllerGuards,
      ...methodGuards,
    ];

    if (allGuards.length === 0) {
      return;
    }

    const executionCtx = new AmqpExecutionContext(
      pattern,
      payload,
      consumer,
      handlerFn as unknown as HttpRouteFn,
    );

    for (const guard of allGuards) {
      let allowed: boolean;

      if (isClass<CanActivate>(guard)) {
        const guardInstance = await this.moduleRef.get(guard, { contextId });
        allowed = await guardInstance.canActivate(executionCtx);
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
}
