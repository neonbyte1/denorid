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
import type {
  Channel,
  ConfirmChannel,
  ConsumeMessage,
  MessageProperties,
  MessagePropertyHeaders,
  Options,
} from "amqplib";
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
  ConsumerQueueOptions,
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

/** Header counting the retries a message went through. */
const RETRY_COUNT_HEADER = "x-retry-count";

/** Header keeping the exchange a retried message was first published to. */
const ORIGINAL_EXCHANGE_HEADER = "x-original-exchange";

/** Header keeping the routing key a retried message was first published with. */
const ORIGINAL_ROUTING_KEY_HEADER = "x-original-routing-key";

/** How a handled message is settled with the broker. */
type Settlement = "ack" | "reject" | "requeue";

/** One decorated handler method and the channel currently consuming for it. */
interface Subscription {
  /** `Consumer.method`, for log messages. */
  label: string;
  consumer: Type;
  binding: AmqpBinding;
  controllerGuards: Guard[];
  methodGuards: Guard[];
  /** Delay queue per retry attempt, when the binding retries failed messages. */
  retryQueues?: string[];
  /** The live consumer channel, unset while (re)subscribing. */
  channel?: ConfirmChannel;
  /** The broker consumer tag on {@link channel}. */
  consumerTag?: string;
  /** Pending resubscribe timer after the channel closed unexpectedly. */
  retry?: NodeJS.Timeout;
  /** A resubscribe in progress. */
  resubscribing?: Promise<void>;
}

/**
 * Builds the `assertQueue` options of a consumer queue, adding the typed queue
 * options as `x-` arguments on top of the raw `queueArguments`.
 *
 * @param {ConsumerQueueOptions} o - The binding's queue options.
 * @param {Options.AssertQueue} base - Durability and exclusivity flags.
 * @return {Options.AssertQueue} The queue declaration options.
 */
function consumerQueueOptions(
  o: ConsumerQueueOptions,
  base: Options.AssertQueue,
): Options.AssertQueue {
  const args: Record<string, unknown> = { ...o.queueArguments };
  const typed: Record<string, unknown> = {
    "x-queue-type": o.queueType,
    "x-dead-letter-exchange": o.deadLetterExchange,
    "x-dead-letter-routing-key": o.deadLetterRoutingKey,
    "x-delivery-limit": o.deliveryLimit,
  };

  for (const [key, value] of Object.entries(typed)) {
    if (value !== undefined) {
      args[key] = value;
    }
  }

  return Object.keys(args).length > 0 ? { ...base, arguments: args } : base;
}

/**
 * Internal consumer runtime. On application bootstrap it discovers
 * `@AmqpConsumer` classes, asserts each binding's topology against the broker,
 * consumes its queue, and dispatches messages to the decorated methods with
 * guard and `ExceptionHandler` integration.
 *
 * A failed message of a binding with `retry` is republished to the delay queue
 * of its attempt (and acked once the broker confirmed the copy); without
 * retries left it is rejected, so the broker dead-letters or drops it.
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
    const channel = await this.connection!.createConfirmChannel();

    try {
      const queueName = await this.assertTopology(channel, subscription);
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
    channel: ConfirmChannel,
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
    subscription: Subscription,
  ): Promise<string> {
    const { binding } = subscription;

    switch (binding.type) {
      case "worker": {
        // Narrowed by the `binding.type` discriminant; the union cannot unify.
        const o = binding.options as WorkerOptions;
        const durable = o.durable ?? true;

        await channel.assertQueue(
          o.queue,
          consumerQueueOptions(o, { durable }),
        );
        await this.assertRetryQueues(
          channel,
          subscription,
          o,
          o.queue,
          durable,
        );
        await channel.prefetch(o.prefetch ?? 1);

        return o.queue;
      }
      case "pub-sub": {
        // Narrowed by the `binding.type` discriminant; the union cannot unify.
        const o = binding.options as PubSubOptions;

        await channel.assertExchange(o.exchange, "fanout", {
          durable: o.durable ?? true,
        });

        const queue = await this.assertBoundQueue(channel, subscription, o);

        await channel.bindQueue(queue, o.exchange, "");

        return queue;
      }
      case "routing": {
        // Narrowed by the `binding.type` discriminant; the union cannot unify.
        const o = binding.options as RoutingOptions;

        await channel.assertExchange(o.exchange, "direct", {
          durable: o.durable ?? true,
        });

        const queue = await this.assertBoundQueue(channel, subscription, o);

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

        const queue = await this.assertBoundQueue(channel, subscription, o);

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

  /**
   * Asserts the queue an exchange binding consumes: the named durable queue,
   * or an exclusive auto-delete server-named one when `queue` is omitted.
   *
   * @param {Channel} channel - The consumer channel.
   * @param {Subscription} subscription - The subscription being set up.
   * @param {PubSubOptions | RoutingOptions | TopicOptions} o - The binding
   *   options.
   * @return {Promise<string>} The queue name.
   */
  private async assertBoundQueue(
    channel: Channel,
    subscription: Subscription,
    o: PubSubOptions | RoutingOptions | TopicOptions,
  ): Promise<string> {
    const response = await channel.assertQueue(
      o.queue ?? "",
      consumerQueueOptions(o, {
        exclusive: !o.queue,
        durable: !!o.queue,
        autoDelete: !o.queue,
      }),
    );

    await this.assertRetryQueues(
      channel,
      subscription,
      o,
      response.queue,
      true,
    );

    return response.queue;
  }

  /**
   * Asserts one delay queue per distinct retry delay. A message published to
   * `<queue>.retry.<delay>` expires after `delay` ms and is dead-lettered back
   * to `queue` through the default exchange. Records the delay queue of every
   * attempt on the subscription.
   *
   * @param {Channel} channel - The consumer channel.
   * @param {Subscription} subscription - The subscription being set up.
   * @param {ConsumerQueueOptions} o - The binding's queue options.
   * @param {string} queue - The consumed queue.
   * @param {boolean} durable - Whether the consumed queue is durable.
   * @return {Promise<void>}
   */
  private async assertRetryQueues(
    channel: Channel,
    subscription: Subscription,
    o: ConsumerQueueOptions,
    queue: string,
    durable: boolean,
  ): Promise<void> {
    if (!o.retry) {
      return;
    }

    for (const delay of new Set(o.retry.delays)) {
      await channel.assertQueue(`${queue}.retry.${delay}`, {
        durable,
        arguments: {
          ...(o.queueType && { "x-queue-type": o.queueType }),
          "x-message-ttl": delay,
          "x-dead-letter-exchange": "",
          "x-dead-letter-routing-key": queue,
        },
      });
    }

    subscription.retryQueues = o.retry.delays.map((delay) =>
      `${queue}.retry.${delay}`
    );
  }

  private async handle(
    subscription: Subscription,
    channel: ConfirmChannel,
    msg: ConsumeMessage,
  ): Promise<void> {
    const { binding, consumer, retryQueues } = subscription;
    const ctx = this.ctx!;
    const headers: MessagePropertyHeaders = msg.properties.headers ?? {};
    // A retried message returns through the default exchange; its original
    // route travels in the headers set when it was sent to a delay queue.
    const route: MessagePropertyHeaders = retryQueues ? headers : {};
    const exchange: string = route[ORIGINAL_EXCHANGE_HEADER] ??
      msg.fields.exchange;
    const routingKey: string = route[ORIGINAL_ROUTING_KEY_HEADER] ??
      msg.fields.routingKey;
    const pattern = routingKey || exchange;
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

    let settlement: Settlement = outcome.ok ? "ack" : "reject";
    const retryCount: number = typeof headers[RETRY_COUNT_HEADER] === "number"
      ? headers[RETRY_COUNT_HEADER]
      : 0;
    const retryQueue = outcome.ok ? undefined : retryQueues?.[retryCount];

    if (retryQueue !== undefined) {
      try {
        await this.publishRetry(channel, msg, retryQueue, {
          [RETRY_COUNT_HEADER]: retryCount + 1,
          [ORIGINAL_EXCHANGE_HEADER]: exchange,
          [ORIGINAL_ROUTING_KEY_HEADER]: routingKey,
        });
        settlement = "ack";
      } catch (err) {
        // Requeued instead of rejected: the message must not get lost.
        this.logger.error("Failed to schedule a retry of an AMQP message", err);
        settlement = "requeue";
      }
    }

    try {
      if (settlement === "ack") {
        channel.ack(msg);
      } else {
        channel.nack(msg, false, settlement === "requeue");
      }
    } catch (err) {
      // The channel closed; the broker redelivers the unsettled message.
      this.logger.error(
        `Failed to ${settlement === "ack" ? "ack" : "nack"} an AMQP message`,
        err,
      );
    }
  }

  /**
   * Publishes a copy of a failed message to a delay queue, resolving once the
   * broker confirmed the copy.
   *
   * @param {ConfirmChannel} channel - The channel the message was consumed on.
   * @param {ConsumeMessage} msg - The failed message.
   * @param {string} retryQueue - The delay queue of this attempt.
   * @param {MessagePropertyHeaders} retryHeaders - Retry count and original
   *   route, merged into the message headers.
   * @return {Promise<void>}
   */
  private publishRetry(
    channel: ConfirmChannel,
    msg: ConsumeMessage,
    retryQueue: string,
    retryHeaders: MessagePropertyHeaders,
  ): Promise<void> {
    // The broker closes the channel when `userId` differs from the user the
    // connection authenticated as.
    const { headers, userId: _userId, ...properties } = msg.properties;
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    channel.sendToQueue(
      retryQueue,
      msg.content,
      { ...properties, headers: { ...headers, ...retryHeaders } },
      (err: unknown): void => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      },
    );

    return promise;
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
