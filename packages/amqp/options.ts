/** AMQP messaging pattern a binding/client implements. */
export type AmqpPatternType =
  | "worker"
  | "pub-sub"
  | "routing"
  | "topic"
  | "rpc";

/** Options for a `@Worker` work-queue handler. */
export interface WorkerOptions {
  /** Work queue name (default exchange, round-robin delivery). */
  queue: string;
  /** Survive broker restarts. Default true. */
  durable?: boolean;
  /** Per-consumer prefetch (fair dispatch). Default 1. */
  prefetch?: number;
}

/** Options for a `@PubSub` fanout handler. */
export interface PubSubOptions {
  /** Fanout exchange name. */
  exchange: string;
  /** Survive broker restarts. Default true. */
  durable?: boolean;
  /** Named bound queue. Omit for an exclusive auto-delete queue. */
  queue?: string;
}

/** Options for a `@Routing` direct-exchange handler. */
export interface RoutingOptions {
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
export interface TopicOptions {
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
