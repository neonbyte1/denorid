/**
 * Defines a contract for serializing values into a transmittable format.
 */
export interface Serializer {
  /**
   * Serializes a value into a string or binary format suitable for transmission.
   *
   * @param {unknown} value - The value to serialize.
   * @return {string | Uint8Array} The serialized representation.
   */
  serialize(value: unknown): string | Uint8Array;
}
