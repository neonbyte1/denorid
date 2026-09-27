import type { AtomicOperation, KvCommitResult, KvKey } from "@deno/kv";
import { Inject, Injectable } from "@denorid/injector";
import { KvConnections } from "../connections.ts";

/**
 * Options forwarded directly to `Kv.enqueue`.
 */
export interface EnqueueOptions {
  /** Delay in milliseconds before the message is delivered. */
  delay?: number;
  /** KV keys that receive the message value if delivery ultimately fails. */
  keysIfUndelivered?: KvKey[];
  /** Custom retry backoff intervals in milliseconds. */
  backoffSchedule?: number[];
}

/**
 * Parameters for {@link KvQueue.send}.
 */
export interface KvQueueSendOptions {
  /** The event identifier attached to the message. */
  id: string;
  /** The target connection name. Defaults to the default queue when omitted. */
  queue?: string;
  /** Optional payload to attach to the message. */
  payload?: object;
  /** Additional enqueue options forwarded to the KV store. */
  options?: EnqueueOptions;
}

/**
 * The internal message envelope stored in the KV queue.
 */
export interface KvQueueMessage {
  /** The event identifier. */
  id: string;
  /** Optional payload data. */
  payload?: object;
}

/**
 * Injectable service for sending messages to a KV queue.
 */
@Injectable()
export class KvQueue {
  /**
   * The underlying connections service used to resolve the target KV instance.
   */
  @Inject(KvConnections)
  private readonly connections!: KvConnections;

  /**
   * Sends a message to the queue, returning a commit result promise.
   *
   * @param {KvQueueSendOptions} options - The message options.
   * @return {Promise<KvCommitResult>}
   */
  public send(options: KvQueueSendOptions): Promise<KvCommitResult>;
  /**
   * Sends a message to the queue as part of an atomic operation.
   *
   * @param {KvQueueSendOptions & { atomic: true }} options - The message options with the atomic flag set.
   * @return {AtomicOperation}
   */
  public send(
    options: KvQueueSendOptions & { atomic: true },
  ): AtomicOperation;
  public send(
    options: KvQueueSendOptions | (KvQueueSendOptions & { atomic: true }),
  ): Promise<KvCommitResult> | AtomicOperation {
    const kv = this.connections.get(options.queue);
    const message: KvQueueMessage = { id: options.id };

    if (options.payload) {
      message.payload = options.payload;
    }

    if ("atomic" in options && options.atomic) {
      return kv.atomic().enqueue(message, options.options);
    }

    return kv.enqueue(message, options.options);
  }
}
