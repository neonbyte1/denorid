import { Injectable } from "@denorid/injector";
import { decode, encode, type ValueType } from "@std/msgpack";
import type { MessageProperties } from "amqplib";
import { Buffer } from "node:buffer";

export { AMQP_SERIALIZER } from "./_constants.ts";

/** `contentType` tagging binary bodies that bypass encoding. */
const BINARY_CONTENT_TYPE = "application/octet-stream";

/** `contentType` tagging JSON-encoded bodies. */
const JSON_CONTENT_TYPE = "application/json";

/** IANA-registered `contentType` tagging MessagePack-encoded bodies. */
const MSGPACK_CONTENT_TYPE = "application/vnd.msgpack";

/** Encoding a built-in serializer publishes and assumes for untagged bodies. */
type BodyFormat = "json" | "msgpack";

/**
 * Decodes a message body by its `contentType` (media type only, case
 * insensitive): raw bytes for `application/octet-stream`, JSON for
 * `application/json`, MessagePack for `application/vnd.msgpack` and the
 * unregistered `application/msgpack` / `application/x-msgpack`. Any other or
 * missing content type is decoded as `fallback`.
 *
 * @param {Uint8Array} content - The raw message content.
 * @param {MessageProperties | undefined} properties - The message properties.
 * @param {BodyFormat} fallback - The encoding of untagged bodies.
 * @return {unknown} The decoded value.
 */
function decodeBody(
  content: Uint8Array,
  properties: MessageProperties | undefined,
  fallback: BodyFormat,
): unknown {
  const mediaType: string | undefined = properties?.contentType
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  let format: BodyFormat = fallback;

  switch (mediaType) {
    case BINARY_CONTENT_TYPE:
      return content;
    case JSON_CONTENT_TYPE:
      format = "json";
      break;
    case MSGPACK_CONTENT_TYPE:
    case "application/msgpack":
    case "application/x-msgpack":
      format = "msgpack";
      break;
  }

  return format === "json"
    ? JSON.parse(new TextDecoder().decode(content))
    : decode(content);
}

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
 * `contentType: "application/octet-stream"`; every other value is JSON-encoded
 * (`contentType: "application/json"`). Values JSON cannot represent at the top
 * level (`undefined`, functions, symbols) are encoded as `null`.
 *
 * Received bodies are decoded by their `contentType`, so messages published
 * by a {@link MsgpackAmqpSerializer} are understood too; untagged bodies are
 * decoded as JSON.
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
    return decodeBody(content, properties, "json");
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

/**
 * MessagePack {@link AmqpSerializer} (`serializer: "msgpack"`), built on
 * `@std/msgpack`: smaller bodies than JSON, and `bigint` and nested
 * `Uint8Array` values survive the round trip.
 *
 * `Uint8Array` payloads are sent verbatim and tagged
 * `contentType: "application/octet-stream"`; every other value is
 * MessagePack-encoded (`contentType: "application/vnd.msgpack"`). A top-level
 * `undefined` (the result of a `void` RPC handler) is encoded as `null`.
 * MessagePack has no representation for nested `undefined` values, `Date`,
 * `Map`, `Set` or class instances: serializing them throws.
 *
 * Received bodies are decoded by their `contentType`, so messages published
 * by a {@link JsonAmqpSerializer} are understood too; untagged bodies are
 * decoded as MessagePack.
 */
@Injectable()
export class MsgpackAmqpSerializer implements AmqpSerializer {
  /**
   * @inheritdoc
   */
  public serialize(value: unknown): Buffer {
    if (value instanceof Uint8Array) {
      return Buffer.from(value);
    }

    const bytes = encode((value ?? null) as ValueType);

    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /**
   * @inheritdoc
   */
  public deserialize(
    content: Uint8Array,
    properties?: MessageProperties,
  ): unknown {
    return decodeBody(content, properties, "msgpack");
  }

  /**
   * @inheritdoc
   */
  public contentType(value: unknown): string {
    return value instanceof Uint8Array
      ? BINARY_CONTENT_TYPE
      : MSGPACK_CONTENT_TYPE;
  }
}
