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
 * A failing message is moved to a delay queue named `<queue>.retry.<delay>`
 * and returns to the consumer queue once the delay expired. After the last
 * delay the next failure rejects the message: the broker dead-letters it when
 * the queue has a `deadLetterExchange`, otherwise it is dropped.
 */
export interface RetryOptions {
  /**
   * Delay before each retry, in milliseconds. `[1_000, 10_000, 60_000]` runs a
   * failing handler up to four times: once, then after 1s, 10s and 60s.
   */
  delays: number[];
}

/** Queue arguments and failure handling for handlers that consume a queue. */
export interface ConsumerQueueOptions {
  /**
   * Queue type (`x-queue-type`). A quorum queue must be named and durable.
   * Default: the broker default (classic).
   */
  queueType?: "classic" | "quorum";
  /** Exchange rejected messages are dead-lettered to (`x-dead-letter-exchange`). */
  deadLetterExchange?: string;
  /**
   * Routing key of dead-lettered messages (`x-dead-letter-routing-key`).
   * Default: the routing key the message was published with.
   */
  deadLetterRoutingKey?: string;
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
  /** Survive broker restarts. Default true. */
  durable?: boolean;
  /** Per-consumer prefetch (fair dispatch). Default 1. */
  prefetch?: number;
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
  /** Per-consumer prefetch. Default 1. */
  prefetch?: number;
}

// ---- client (sender) options ----

/** Options for a {@link WorkerClient}. */
export interface WorkerClientOptions {
  /** Target work queue. */
  queue: string;
  /** Assert queue as durable. Default true. */
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
