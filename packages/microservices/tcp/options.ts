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
  /**
   * Maximum byte size of a single received frame body. A peer announcing a
   * larger frame is disconnected: `TcpServer` answers the requests already
   * running on that connection and then closes it, `TcpClient` rejects its
   * pending requests with `Connection closed`. Defaults to 64 MiB.
   *
   * @default 67108864
   */
  maxBufferSize?: number;
}

export type TcpTransportOptions = TransportOptions<Transport.TCP, TcpOptions>;
