import type { HttpMethod } from "./method.ts";

/** CORS (Cross-Origin Resource Sharing) configuration options. */
export interface CorsOptions {
  /** Allowed origin(s) for cross-origin requests. Can be a string or array of strings. */
  origin: string | string[];
  /** HTTP methods to allow in CORS requests (e.g., GET, POST, PUT, DELETE). */
  allowMethods?: (HttpMethod | keyof typeof HttpMethod)[];
  /** Custom headers to allow in CORS requests. */
  allowHeaders?: string[];
  /** Maximum time (seconds) browsers should cache CORS preflight responses. */
  maxAge?: number;
  /** Whether to allow credentials (cookies, authorization headers) in cross-origin requests. */
  credentials?: boolean;
  /** Custom headers that can be exposed to the client. */
  exposeHeaders?: string[];
}
