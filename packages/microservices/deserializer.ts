/**
 * Defines a contract for deserializing raw incoming data into a usable structure.
 */
export interface Deserializer {
  /**
   * Deserializes raw incoming data into a structured value.
   *
   * @param {unknown} data - The raw data to deserialize.
   * @return {unknown} The deserialized value.
   */
  deserialize(data: unknown): unknown;
}
