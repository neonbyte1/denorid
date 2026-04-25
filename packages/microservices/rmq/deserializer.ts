import type { Deserializer } from "../deserializer.ts";

/**
 * Default RMQ-transport deserializer.
 *
 * Parses JSON-encoded `Buffer` / `Uint8Array` values into structured objects.
 */
export class RmqDeserializer implements Deserializer {
  /**
   * @inheritdoc
   */
  public deserialize(data: unknown): unknown {
    if (data instanceof Uint8Array) {
      return JSON.parse(new TextDecoder().decode(data));
    }

    return JSON.parse(String(data));
  }
}
