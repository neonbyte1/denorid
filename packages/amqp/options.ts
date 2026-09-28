/** AMQP messaging pattern a binding/client implements. */
export type AmqpPatternType =
  | "worker"
  | "pub-sub"
  | "routing"
  | "topic"
  | "rpc";

/**
 * Delayed redelivery for messages whose handler threw.
 *
 * A failing message is republished, with its routing key, to the delay queue
 * `<queue>.retry.<delay>` and returns to the consumer queue through the
 * `<queue>.retry` exchange once the delay expired. After the last delay the
 * next failure rejects the message: the broker dead-letters it (still with its
 * original routing key) when the queue has a `deadLetterExchange`, otherwise
 * it is dropped. A handler throwing a {@link RejectMessageException} has its
 * message rejected right away, without retries.
 */
export interface RetryOptions {
  /**
   * Delay before each retry, in milliseconds. `[1_000, 10_000, 60_000]` runs a
   * failing handler up to four times: once, then after 1s, 10s and 60s.
   */
  delays: number[];
}

/**
 * Arguments of a declared queue. A queue must be declared with the same
 * arguments everywhere: the broker refuses a redeclaration whose arguments
 * differ (406 PRECONDITION_FAILED).
 */
export interface QueueDeclarationOptions {
  /**
   * Queue type (`x-queue-type`). A quorum queue must be named and durable.
   * Default: the broker default (classic).
   */
  queueType?: "classic" | "quorum";
  /**
   * Exchange rejected messages are dead-lettered to (`x-dead-letter-exchange`).
   * Default with `deadLetterQueue`: `<queue>.dlx`; otherwise none.
   */
  deadLetterExchange?: string;
  /**
   * Routing key of dead-lettered messages (`x-dead-letter-routing-key`).
   * Default with `deadLetterQueue`: the queue name; otherwise the routing key
   * the message was published with.
   */
  deadLetterRoutingKey?: string;
  /**
   * Opt-in: also declare the dead-letter topology, so a rejected message
   * always has somewhere to go. `true` names the dead-letter queue
   * `<queue>.dlq`, a string names it explicitly.
   *
   * The dead-letter exchange (`deadLetterExchange`, default `<queue>.dlx`) is
   * declared as a durable `direct` exchange and the durable dead-letter queue
   * (with this queue's `queueType`) is bound to it with the dead-letter routing
   * key (`deadLetterRoutingKey`, default the queue name), which the queue
   * dead-letters with. Several queues can thus share one dead-letter exchange.
   * A message's original routing key stays in its `x-death` header. Requires a
   * named queue. Default: false, the topology is left to the application.
   */
  deadLetterQueue?: boolean | string;
  /**
   * Deliveries after which a quorum queue dead-letters a message that keeps
   * being returned, e.g. by a consumer crashing mid-handler
   * (`x-delivery-limit`). Quorum queues only.
   */
  deliveryLimit?: number;
  /**
   * Additional queue arguments (`x-max-length`, `x-message-ttl`, ...). The
   * typed options above take precedence.
   */
  queueArguments?: Record<string, unknown>;
}

/** Queue arguments, flow control and failure handling for handlers that consume a queue. */
export interface ConsumerQueueOptions extends QueueDeclarationOptions {
  /**
   * Unacknowledged messages the broker hands this handler at once (fair
   * dispatch, bounded concurrency). Default 1.
   */
  prefetch?: number;
  /**
   * Delayed retries for a failing handler. Requires a named queue. Default:
   * none, a failing message is rejected right away.
   */
  retry?: RetryOptions;
}

/** Options for a `@Worker` work-queue handler. */
export interface WorkerOptions extends ConsumerQueueOptions {
  /** Work queue name (default exchange, round-robin delivery). */
  queue: string;
  /**
   * Survive broker restarts. Default true. RabbitMQ 4 refuses a non-durable
   * named queue unless the deprecated `transient_nonexcl_queues` feature is
   * enabled.
   */
  durable?: boolean;
}

/** Options for a `@PubSub` fanout handler. */
export interface PubSubOptions extends ConsumerQueueOptions {
  /** Fanout exchange name. */
  exchange: string;
  /** Survive broker restarts. Default true. */
  durable?: boolean;
  /** Named bound queue. Omit for an exclusive auto-delete queue. */
  queue?: string;
}

/** Options for a `@Routing` direct-exchange handler. */
export interface RoutingOptions extends ConsumerQueueOptions {
  /** Direct exchange name. */
  exchange: string;
  /** Binding keys this handler subscribes to (>=1). */
  routingKeys: string[];
  /** Named bound queue. Omit for an exclusive auto-delete queue. */
  queue?: string;
  /** Survive broker restarts. Default true. */
  durable?: boolean;
}

/** Options for a `@Topic` topic-exchange handler. */
export interface TopicOptions extends ConsumerQueueOptions {
  /** Topic exchange name. */
  exchange: string;
  /** Binding patterns (may contain `*` / `#`) (>=1). */
  routingKeys: string[];
  /** Named bound queue. Omit for an exclusive auto-delete queue. */
  queue?: string;
  /** Survive broker restarts. Default true. */
  durable?: boolean;
}

/** Options for a `@Rpc` request/reply handler. */
export interface RpcOptions {
  /** Request queue name. */
  queue: string;
  /**
   * Survive broker restarts. Default true. RabbitMQ 4 refuses a non-durable
   * named queue unless the deprecated `transient_nonexcl_queues` feature is
   * enabled.
   */
  durable?: boolean;
  /** Per-consumer prefetch. Default 1. */
  prefetch?: number;
}

// ---- client (sender) options ----

/**
 * Options for a {@link WorkerClient}. The queue declaration options must match
 * the ones of the `@Worker` consuming the queue. `deadLetterQueue` only shapes
 * the queue arguments here; the `@Worker` declares the dead-letter topology.
 */
export interface WorkerClientOptions extends QueueDeclarationOptions {
  /** Target work queue. */
  queue: string;
  /**
   * Assert queue as durable. Default true. RabbitMQ 4 refuses a non-durable
   * named queue unless the deprecated `transient_nonexcl_queues` feature is
   * enabled.
   */
  durable?: boolean;
  /** Persist published messages to disk. Default true. */
  persistent?: boolean;
}

/** Shared options for the fanout/direct/topic publisher clients. */
export interface ExchangeClientOptions {
  /** Target exchange name. */
  exchange: string;
  /** Assert exchange as durable. Default true. */
  durable?: boolean;
  /** Persist published messages to disk. Default true. */
  persistent?: boolean;
}

/** Per-message properties accepted by the publishing clients. */
export interface PublishOptions {
  /** Application message id, e.g. an event id consumers deduplicate on. */
  messageId?: string;
  /** Custom headers, e.g. W3C trace context (`traceparent`). */
  headers?: Record<string, unknown>;
  /** Id correlating this message with related ones. */
  correlationId?: string;
  /** Application message type, e.g. the event name. */
  type?: string;
  /** Creation time, in seconds since the Unix epoch. */
  timestamp?: number;
  /** Persist this message to disk. Default: the client's `persistent` option. */
  persistent?: boolean;
}

/** Options for an {@link RpcClient}. */
export interface RpcClientOptions {
  /** Target request queue. */
  queue: string;
  /** Reply timeout in ms. Omit to wait indefinitely. */
  timeout?: number;
}

/**
 * Declarative client registration for {@link AmqpModuleOptions.clients}.
 *
 * Bundles a client's options with the injection token to expose it under and
 * the pattern selecting the client class: `worker` -> {@link WorkerClient},
 * `pub-sub` -> {@link PublisherClient}, `routing` -> {@link RoutingClient},
 * `topic` -> {@link TopicClient}, `rpc` -> {@link RpcClient}.
 */
export type AmqpClientRegistration =
  & (WorkerClientOptions | ExchangeClientOptions | RpcClientOptions)
  & {
    /** Injection token the constructed client is provided and exported under. */
    name: string | symbol;
    /** Messaging pattern selecting which client class to instantiate. */
    type: AmqpPatternType;
  };
