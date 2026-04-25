import { Buffer } from "node:buffer";
import type { Serializer } from "../serializer.ts";

/**
 * Default RMQ-transport serializer.
 *
 * Encodes values as JSON buffers, with binary passthrough for `Uint8Array` payloads.
 */
export class RmqSerializer implements Serializer {
  /**
   * @inheritdoc
   */
  public serialize(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) {
      return Buffer.from(value);
    }
    return Buffer.from(JSON.stringify(value));
  }

  /**
   * Returns the AMQP `contentType` value that describes the serialized form of `value`.
   *
   * @param {unknown} value - The value about to be serialized.
   * @return {string} `"application/octet-stream"` for `Uint8Array`, otherwise `"application/json"`.
   */
  public contentTypeFor(value: unknown): string {
    return value instanceof Uint8Array
      ? "application/octet-stream"
      : "application/json";
  }
}
