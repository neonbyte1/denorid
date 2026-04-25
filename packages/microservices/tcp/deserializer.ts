import { decode } from "@std/msgpack";
import type { Deserializer } from "../deserializer.ts";

/**
 * Default TCP-transport deserializer.
 *
 * Decodes MessagePack bytes back to a value.
 */
export class TcpDeserializer implements Deserializer {
  /**
   * @inheritdoc
   */
  public deserialize(data: unknown): unknown {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError(
        `Can not deserialize type ${typeof data}, expected Uint8Array`,
      );
    }

    return decode(data);
  }
}
