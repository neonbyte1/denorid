import { Injectable } from "@denorid/injector";
import type { MessageProperties } from "amqplib";
import { Buffer } from "node:buffer";

export { AMQP_SERIALIZER } from "./_constants.ts";

/** `contentType` tagging binary bodies that bypass JSON encoding. */
const BINARY_CONTENT_TYPE = "application/octet-stream";

/** `contentType` tagging JSON-encoded bodies. */
const JSON_CONTENT_TYPE = "application/json";

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
   * @param {MessageProperties} [properties] - The properties of the received
   *   message (for example its `contentType`), when available.
   * @return {unknown} The decoded value.
   */
  deserialize(content: Uint8Array, properties?: MessageProperties): unknown;

  /**
   * Returns the AMQP `contentType` property describing the body
   * {@link serialize} produces for `value`. Publishers attach it to every
   * message so {@link deserialize} can tell encodings apart. Optional: without
   * it, messages are published without a `contentType`.
   *
   * @param {unknown} value - The value about to be serialized.
   * @return {string | undefined} The content type, or `undefined` for none.
   */
  contentType?(value: unknown): string | undefined;
}

/**
 * Default {@link AmqpSerializer}: JSON encoding with `Uint8Array` passthrough.
 *
 * `Uint8Array` payloads are sent verbatim and tagged
 * `contentType: "application/octet-stream"`; received bodies carrying that
 * content type are returned as raw bytes. Every other value is JSON-encoded
 * (`contentType: "application/json"`); values JSON cannot represent at the top
 * level (`undefined`, functions, symbols) are encoded as `null`.
 */
@Injectable()
export class JsonAmqpSerializer implements AmqpSerializer {
  /**
   * @inheritdoc
   */
  public serialize(value: unknown): Buffer {
    return value instanceof Uint8Array
      ? Buffer.from(value)
      : Buffer.from(JSON.stringify(value) ?? "null");
  }

  /**
   * @inheritdoc
   */
  public deserialize(
    content: Uint8Array,
    properties?: MessageProperties,
  ): unknown {
    if (properties?.contentType === BINARY_CONTENT_TYPE) {
      return content;
    }

    return JSON.parse(new TextDecoder().decode(content));
  }

  /**
   * @inheritdoc
   */
  public contentType(value: unknown): string {
    return value instanceof Uint8Array
      ? BINARY_CONTENT_TYPE
      : JSON_CONTENT_TYPE;
  }
}
