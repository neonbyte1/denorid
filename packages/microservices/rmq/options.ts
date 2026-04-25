import type { Transport, TransportOptions } from "@denorid/core/microservices";

/**
 * Structured representation of a RabbitMQ connection URL.
 */
export interface RmqUrl {
  /** Connection protocol (e.g. `amqp` or `amqps`). */
  protocol?: string;
  /** Hostname or IP address of the RabbitMQ broker. */
  hostname?: string;
  /** Port of the RabbitMQ broker. */
  port?: number;
  /** Username for authentication. */
  username?: string;
  /** Password for authentication. */
  password?: string;
  /** Locale for broker error messages. */
  locale?: string;
  /** Maximum frame size in bytes. */
  frameMax?: number;
  /** Heartbeat interval in seconds. */
  heartbeat?: number;
  /** Virtual host to connect to. */
  vhost?: string;
}

/**
 * Queue declaration options passed to amqplib.
 */
export interface AmqplibQueueOptions {
  /** Survive broker restarts when `true`. */
  durable?: boolean;
  /** Delete queue when last consumer unsubscribes. */
  autoDelete?: boolean;
  /** Additional broker-specific arguments. */
  arguments?: unknown;
  /** TTL in milliseconds for messages in the queue. */
  messageTtl?: number;
  /** Queue expiry time in milliseconds when unused. */
  expires?: number;
  /** Exchange to route dead-lettered messages to. */
  deadLetterExchange?: string;
  /** Routing key for dead-lettered messages. */
  deadLetterRoutingKey?: string;
  /** Maximum number of messages the queue holds. */
  maxLength?: number;
  /** Maximum priority level for a priority queue. */
  maxPriority?: number;
  [key: string]: unknown;
}

/**
 * Exchange declaration options passed to amqplib.
 */
export interface AmqplibExchangeOptions {
  /** Survive broker restarts when `true`. */
  durable?: boolean;
  /** Reject publishes from clients; only other exchanges can route to it. */
  internal?: boolean;
  /** Delete exchange when no longer bound to any queue. */
  autoDelete?: boolean;
  /** Fallback exchange for unroutable messages. */
  alternateExchange?: string;
  /** Additional broker-specific arguments. */
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Configuration options for the RabbitMQ transport.
 */
export interface RmqOptions {
  /** Broker connection URL as a string or structured {@link RmqUrl}. */
  url?: string | RmqUrl;
  /** Name of the queue to consume from or publish to. */
  queue?: string;
  /** Number of messages fetched from the broker at once. */
  prefetchCount?: number;
  /** Apply `prefetchCount` globally across all consumers on the channel when `true`. */
  isGlobalPrefetchCount?: boolean;
  /** Queue declaration options forwarded to amqplib. */
  queueOptions?: AmqplibQueueOptions;
  /** Exchange declaration options forwarded to amqplib. */
  exchangeOptions?: AmqplibExchangeOptions;
  /** Skip manual acknowledgement; broker auto-acks messages when `true`. */
  noAck?: boolean;
  /** Consumer tag used to identify the consumer on the broker. */
  consumerTag?: string;
  /** Queue name used for RPC reply messages. */
  replyQueue?: string;
  /** Persist messages to disk when `true`. */
  persistent?: boolean;
  /** Additional headers attached to every published message. */
  headers?: Record<string, string>;
  /** Skip queue and exchange assertion on connect when `true`. */
  noAssert?: boolean;
  /** Exchange to publish messages to. */
  exchange?: string;
  /** Type of the exchange (`direct`, `fanout`, `topic`, or `headers`). */
  exchangeType?: "direct" | "fanout" | "topic" | "headers";
  /** Routing key used when publishing to an exchange. */
  routingKey?: string;
  /** Maximum number of connection attempts before giving up. */
  maxConnectionAttempts?: number;
}

export type RmqTransportOptions = TransportOptions<Transport.RMQ, RmqOptions>;
