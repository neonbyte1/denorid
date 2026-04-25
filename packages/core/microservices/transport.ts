/** Identifies the transport layer used by a microservice. */
export enum Transport {
  TCP = 0,
  RMQ,
}

/**
 * Configuration for a specific microservice transport.
 *
 * @template Id - The {@link Transport} variant this config applies to.
 * @template T - Transport-specific options object.
 */
export interface TransportOptions<
  Id extends Transport,
  T extends object = Record<string, unknown>,
> {
  /** Transport variant to use. */
  transport: Id;
  /** Transport-specific configuration. */
  options?: T;
}
