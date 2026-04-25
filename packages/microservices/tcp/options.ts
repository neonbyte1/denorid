import type { Transport, TransportOptions } from "@denorid/core/microservices";

/**
 * Configuration options for the TCP transport.
 */
export interface TcpOptions {
  /**
   * Hostname or IP address to connect to or listen on.
   *
   * @default "localhost"
   */
  host?: string;
  /**
   * Port number to connect to or listen on.
   *
   * @default 3000
   */
  port?: number;
  /** Number of reconnection attempts before giving up. */
  retryAttempts?: number;
  /** Delay in milliseconds between reconnection attempts. */
  retryDelay?: number;
  /** Maximum byte size of the receive buffer. */
  maxBufferSize?: number;
}

export type TcpTransportOptions = TransportOptions<Transport.TCP, TcpOptions>;
