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
import type { Buffer } from "node:buffer";
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

/** Result of running a handler: its return value or the error it threw. */
type HandlerOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: unknown };

/** Default delay before a consumer whose channel closed is subscribed again. */
const DEFAULT_RECONNECT_DELAY = 1000;

/** One decorated handler method and the channel currently consuming for it. */
interface Subscription {
  /** `Consumer.method`, for log messages. */
  label: string;
  consumer: Type;
  binding: AmqpBinding;
  controllerGuards: Guard[];
  methodGuards: Guard[];
  /** The live consumer channel, unset while (re)subscribing. */
  channel?: Channel;
  /** The broker consumer tag on {@link channel}. */
  consumerTag?: string;
  /** Pending resubscribe timer after the channel closed unexpectedly. */
  retry?: NodeJS.Timeout;
  /** A resubscribe in progress. */
  resubscribing?: Promise<void>;
}

/**
 * Internal consumer runtime. On application bootstrap it discovers
 * `@AmqpConsumer` classes, asserts each binding's topology against the broker,
 * consumes its queue, and dispatches messages to the decorated methods with
 * guard and `ExceptionHandler` integration.
 *
 * A consumer whose channel closes unexpectedly (broker restart, connection
 * loss, channel error) is subscribed again after
 * `AmqpModuleOptions.reconnectDelay`. Before application shutdown every
 * consumer is cancelled, in-flight handlers are awaited (so they can still
 * ack and reply), and only then are the channels closed.
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

  private readonly subscriptions: Subscription[] = [];
  private readonly inFlight: Set<Promise<void>> = new Set();
  private connection?: AmqpConnection;
  private ctx?: InjectorContext;
  private stopping = false;

  public constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * @inheritdoc
   */
  public onApplicationBootstrap(): Promise<void> {
    return this.discover();
  }

  /**
   * Cancels every consumer, waits for the handlers still running, then
   * closes the consumer channels. Idempotent.
   *
   * @return {Promise<void>}
   */
  public async onBeforeApplicationShutdown(): Promise<void> {
    this.stopping = true;

    for (const subscription of this.subscriptions) {
      clearTimeout(subscription.retry);
      subscription.retry = undefined;
    }

    await Promise.allSettled(
      this.subscriptions.map((subscription) => subscription.resubscribing),
    );

    for (const { channel, consumerTag } of this.subscriptions) {
      try {
        await channel?.cancel(consumerTag!);
        // deno-lint-ignore no-empty
      } catch {}
    }

    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }

    for (const subscription of this.subscriptions) {
      const channel = subscription.channel;

      subscription.channel = undefined;

      try {
        await channel?.close();
        // deno-lint-ignore no-empty
      } catch {}
    }

    this.subscriptions.length = 0;
  }

  private async discover(): Promise<void> {
    const consumers = this.moduleRef.getTokensByTag<Type>(AMQP_CONSUMER, {
      strict: false,
    });

    if (consumers.length === 0) {
      return;
    }

    this.connection = await this.moduleRef.get(AmqpConnection);
    this.ctx = await this.moduleRef.get(InjectorContext, { strict: false });

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
        const subscription: Subscription = {
          label: `${consumer.name}.${String(binding.method)}`,
          consumer,
          binding,
          controllerGuards,
          methodGuards: [
            ...(getMethodGuards(consumer, binding.method) ?? new Set<Guard>()),
          ],
        };

        this.subscriptions.push(subscription);

        await this.subscribe(subscription);
      }
    }
  }

  private async subscribe(subscription: Subscription): Promise<void> {
    const channel = await this.connection!.createChannel();

    try {
      const queueName = await this.assertTopology(
        channel,
        subscription.binding,
      );
      const { consumerTag } = await channel.consume(
        queueName,
        (msg) => {
          if (msg !== null) {
            this.dispatch(subscription, channel, msg);
          }
        },
        { noAck: false },
      );

      subscription.channel = channel;
      subscription.consumerTag = consumerTag;
    } catch (err) {
      try {
        await channel.close();
        // deno-lint-ignore no-empty
      } catch {}

      throw err;
    }

    channel.once("close", () => {
      if (subscription.channel !== channel) {
        return;
      }

      subscription.channel = undefined;
      subscription.consumerTag = undefined;

      if (!this.stopping) {
        this.logger.warn(
          `Consumer channel of ${subscription.label} closed, subscribing again`,
        );
        this.scheduleResubscribe(subscription);
      }
    });
  }

  private scheduleResubscribe(subscription: Subscription): void {
    subscription.retry = setTimeout(() => {
      subscription.retry = undefined;
      subscription.resubscribing = this.subscribe(subscription)
        .catch((err: unknown) => {
          this.logger.error(
            `Failed to subscribe ${subscription.label} again`,
            err,
          );

          if (!this.stopping) {
            this.scheduleResubscribe(subscription);
          }
        })
        .finally(() => {
          subscription.resubscribing = undefined;
        });
    }, this.options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY);
  }

  private dispatch(
    subscription: Subscription,
    channel: Channel,
    msg: ConsumeMessage,
  ): void {
    const task: Promise<void> = this.handle(subscription, channel, msg)
      .catch((err: unknown) => {
        this.logger.error("Unhandled error in AMQP message handler", err);
      })
      .finally(() => {
        this.inFlight.delete(task);
      });

    this.inFlight.add(task);
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
    subscription: Subscription,
    channel: Channel,
    msg: ConsumeMessage,
  ): Promise<void> {
    const { binding, consumer } = subscription;
    const ctx = this.ctx!;
    const pattern = msg.fields.routingKey || msg.fields.exchange;
    const contextId = crypto.randomUUID();
    const replyTo: string | undefined = msg.properties.replyTo;

    const outcome = await ctx.runInRequestScopeAsync(
      contextId,
      async (): Promise<HandlerOutcome> => {
        let payload: unknown;

        try {
          payload = this.serializer.deserialize(msg.content, msg.properties);

          // The DI container resolves the consumer class to its instance shape.
          const instance = await this.moduleRef.get(consumer, {
            contextId,
            strict: false,
          }) as ConsumerInstance;

          await this.runGuards(
            contextId,
            pattern,
            payload,
            subscription,
            instance[binding.method],
          );

          return {
            ok: true,
            result: await instance[binding.method](payload, msg.properties),
          };
        } catch (error) {
          await this.exceptionHandler.handle(
            error,
            new AmqpHostArguments(pattern, payload),
          );

          return { ok: false, error };
        } finally {
          ctx.clearContext(contextId);
        }
      },
    );

    if (binding.type === "rpc" && replyTo) {
      this.reply(channel, replyTo, msg.properties.correlationId, outcome);
    }

    try {
      if (outcome.ok) {
        channel.ack(msg);
      } else {
        channel.nack(msg, false, false);
      }
    } catch (err) {
      // The channel closed; the broker redelivers the unsettled message.
      this.logger.error(
        `Failed to ${outcome.ok ? "ack" : "nack"} an AMQP message`,
        err,
      );
    }
  }

  /**
   * Sends the RPC reply for a handled message: the handler's result, or an
   * `{ err }` envelope when it threw or its result could not be serialized.
   * Never throws: a failed reply is logged.
   *
   * @param {Channel} channel - The channel the message was consumed on.
   * @param {string} replyTo - The caller's reply queue.
   * @param {string | undefined} correlationId - The caller's correlation id.
   * @param {HandlerOutcome} outcome - The handler result or error.
   */
  private reply(
    channel: Channel,
    replyTo: string,
    correlationId: string | undefined,
    outcome: HandlerOutcome,
  ): void {
    let value: unknown = outcome.ok
      ? outcome.result
      : { err: String(outcome.error) };

    try {
      let content: Buffer;

      try {
        content = this.serializer.serialize(value);
      } catch (err) {
        this.logger.error("Failed to serialize the AMQP RPC reply", err);
        value = { err: `Failed to serialize reply: ${String(err)}` };
        content = this.serializer.serialize(value);
      }

      channel.sendToQueue(replyTo, content, {
        correlationId,
        contentType: this.serializer.contentType?.(value),
      });
    } catch (err) {
      this.logger.error("Failed to send the AMQP RPC reply", err);
    }
  }

  private async runGuards(
    contextId: string,
    pattern: string,
    payload: unknown,
    { consumer, controllerGuards, methodGuards }: Subscription,
    handlerFn: ConsumerInstance[string | symbol],
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
        const guardInstance = await this.moduleRef.get(guard, {
          contextId,
          strict: false,
        });
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
