import type { Deserializer } from "../deserializer.ts";
import type { Serializer } from "../serializer.ts";

const LENGTH_PREFIX_BYTES = 4;
const MAX_FRAME_BYTES = 64 * 1024 * 1024; // 64 MiB hard limit

/**
 * Encodes a value as a length-prefixed frame ready for TCP transmission.
 *
 * Wire format: `[u32 big-endian length][serialized body]`
 *
 * @param {unknown} frame - The value to encode.
 * @param {Serializer} serializer - Serializer used to encode the frame body.
 * @return {Uint8Array} Length-prefixed bytes.
 */
export function encodeFrame(
  frame: unknown,
  serializer: Serializer,
): Uint8Array {
  const body = serializer.serialize(frame) as Uint8Array;
  const buf = new Uint8Array(LENGTH_PREFIX_BYTES + body.byteLength);
  const view = new DataView(buf.buffer);
  view.setUint32(0, body.byteLength, false);
  buf.set(body, LENGTH_PREFIX_BYTES);
  return buf;
}

/**
 * Decodes a frame body (without the length prefix) into a value.
 *
 * @param {Uint8Array} body - Raw frame body bytes.
 * @param {Deserializer} deserializer - Deserializer used to decode the body.
 * @return {unknown} The parsed value.
 */
export function decodeFrame(
  body: Uint8Array,
  deserializer: Deserializer,
): unknown {
  return deserializer.deserialize(body);
}

/**
 * Reads one length-prefixed frame from a `Deno.TcpConn`.
 *
 * Reads the 4-byte big-endian length header, then reads exactly that many
 * body bytes, accumulating across multiple `read()` calls as needed.
 *
 * @param {Deno.TcpConn} conn - The TCP connection to read from.
 * @return {Promise<Uint8Array | null>} The frame body bytes, or `null` on EOF.
 * @throws {RangeError} When the declared frame length exceeds {@link MAX_FRAME_BYTES}.
 */
export async function readFrame(
  conn: Deno.TcpConn,
): Promise<Uint8Array | null> {
  const header = await readExact(conn, LENGTH_PREFIX_BYTES);

  if (header === null) {
    return null;
  }

  const length = new DataView(
    header.buffer,
    header.byteOffset,
    LENGTH_PREFIX_BYTES,
  ).getUint32(0, false);

  if (length > MAX_FRAME_BYTES) {
    throw new RangeError(`Frame too large: ${length} bytes`);
  }

  return readExact(conn, length);
}

async function readExact(
  conn: Deno.TcpConn,
  n: number,
): Promise<Uint8Array | null> {
  const buf = new Uint8Array(n);
  let offset = 0;

  while (offset < n) {
    let bytesRead: number | null;

    try {
      bytesRead = await conn.read(buf.subarray(offset));
    } catch {
      return null;
    }

    if (bytesRead === null) {
      return offset === 0 ? null : null; // partial frame = treat as EOF
    }

    offset += bytesRead;
  }

  return buf;
}
