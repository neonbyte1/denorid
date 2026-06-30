import { Injectable } from "@denorid/injector";
import { Buffer } from "node:buffer";

export { AMQP_SERIALIZER } from "./_constants.ts";

/**
 * Encodes outgoing payloads to AMQP message bodies and decodes incoming bodies
 * back into structured values.
 *
 * Override the default {@link JsonAmqpSerializer} by setting
 * `AmqpModuleOptions.serializer` (an instance) or by registering a provider for
 * the {@link AMQP_SERIALIZER} token via `extraProviders`.
 */
export interface AmqpSerializer {
  /**
   * Encodes a value into an AMQP message body.
   *
   * @param {unknown} value - The value to encode.
   * @return {Buffer} The encoded message body.
   */
  serialize(value: unknown): Buffer;

  /**
   * Decodes an AMQP message body into a structured value.
   *
   * @param {Uint8Array} content - The raw message content.
   * @return {unknown} The decoded value.
   */
  deserialize(content: Uint8Array): unknown;
}

/**
 * Default {@link AmqpSerializer}: JSON encoding with `Uint8Array` passthrough.
 *
 * `Uint8Array` payloads are sent verbatim; every other value is JSON-encoded.
 */
@Injectable()
export class JsonAmqpSerializer implements AmqpSerializer {
  /**
   * @inheritdoc
   */
  public serialize(value: unknown): Buffer {
    return value instanceof Uint8Array
      ? Buffer.from(value)
      : Buffer.from(JSON.stringify(value));
  }

  /**
   * @inheritdoc
   */
  public deserialize(content: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(content));
  }
}
