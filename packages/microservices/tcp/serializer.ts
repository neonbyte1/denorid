import { encode, type ValueType } from "@std/msgpack";
import type { Serializer } from "../serializer.ts";

/**
 * Default TCP-transport serializer.
 *
 * Encodes values to MessagePack bytes using the internal codec.
 */
export class TcpSerializer implements Serializer {
  /**
   * @inheritdoc
   */
  public serialize(value: unknown): Uint8Array {
    return encode(value as ValueType);
  }
}
