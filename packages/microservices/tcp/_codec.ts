import type { Socket } from "node:net";
import type { Deserializer } from "../deserializer.ts";
import type { Serializer } from "../serializer.ts";

const LENGTH_PREFIX_BYTES = 4;

/** Largest accepted frame body unless configured otherwise: 64 MiB. */
const DEFAULT_MAX_FRAME_BYTES = 64 * 1024 * 1024;

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
 * Incremental decoder that splits an arbitrarily chunked byte stream into
 * length-prefixed frame bodies.
 *
 * Handles frames split across chunks as well as multiple frames per chunk.
 * Each body is copied into its own buffer, so callers may keep it after
 * the source chunk is reused.
 */
export class FrameDecoder {
  private readonly header = new Uint8Array(LENGTH_PREFIX_BYTES);
  private readonly headerView = new DataView(this.header.buffer);
  private headerFilled = 0;
  private body?: Uint8Array;
  private bodyFilled = 0;

  /**
   * @param {number} [maxFrameBytes=DEFAULT_MAX_FRAME_BYTES] - Largest accepted frame body in bytes.
   */
  public constructor(
    private readonly maxFrameBytes: number = DEFAULT_MAX_FRAME_BYTES,
  ) {}

  /**
   * Feeds a chunk of received bytes into the decoder.
   *
   * @param {Uint8Array} chunk - Bytes received from the peer.
   * @return {Uint8Array[]} Every frame body completed by this chunk, in order.
   * @throws {RangeError} When a declared frame length exceeds the maximum frame size.
   */
  public push(chunk: Uint8Array): Uint8Array[] {
    const frames: Uint8Array[] = [];
    let offset = 0;

    while (offset < chunk.byteLength) {
      if (this.body === undefined) {
        const count = Math.min(
          LENGTH_PREFIX_BYTES - this.headerFilled,
          chunk.byteLength - offset,
        );

        this.header.set(
          chunk.subarray(offset, offset + count),
          this.headerFilled,
        );
        this.headerFilled += count;
        offset += count;

        if (this.headerFilled < LENGTH_PREFIX_BYTES) {
          break;
        }

        const length = this.headerView.getUint32(0, false);

        if (length > this.maxFrameBytes) {
          throw new RangeError(`Frame too large: ${length} bytes`);
        }

        this.headerFilled = 0;
        this.body = new Uint8Array(length);
        this.bodyFilled = 0;
      }

      const count = Math.min(
        this.body.byteLength - this.bodyFilled,
        chunk.byteLength - offset,
      );

      this.body.set(chunk.subarray(offset, offset + count), this.bodyFilled);
      this.bodyFilled += count;
      offset += count;

      if (this.bodyFilled === this.body.byteLength) {
        frames.push(this.body);
        this.body = undefined;
      }
    }

    return frames;
  }
}

/**
 * Reads length-prefixed frames from a byte stream such as a `node:net`
 * `Socket` until the stream ends.
 *
 * A read error on the source is treated like EOF, and a trailing partial
 * frame is discarded.
 *
 * @param {AsyncIterable<Uint8Array>} source - The byte stream to read from.
 * @param {number} [maxFrameBytes=DEFAULT_MAX_FRAME_BYTES] - Largest accepted frame body in bytes.
 * @return {AsyncGenerator<Uint8Array, void, undefined>} The frame bodies, in order.
 * @throws {RangeError} When a declared frame length exceeds `maxFrameBytes`.
 */
export async function* readFrames(
  source: AsyncIterable<Uint8Array>,
  maxFrameBytes: number = DEFAULT_MAX_FRAME_BYTES,
): AsyncGenerator<Uint8Array, void, undefined> {
  const decoder = new FrameDecoder(maxFrameBytes);
  const chunks = source[Symbol.asyncIterator]();

  while (true) {
    let result: IteratorResult<Uint8Array>;

    try {
      result = await chunks.next();
    } catch {
      return; // connection error = EOF
    }

    if (result.done) {
      return;
    }

    yield* decoder.push(result.value);
  }
}

/**
 * Writes an encoded frame to a socket.
 *
 * @param {Socket} socket - The socket to write to.
 * @param {Uint8Array} frame - Length-prefixed bytes from {@link encodeFrame}.
 * @return {Promise<void>} Resolves once the frame was handed to the OS, rejects on write errors.
 */
export function writeFrame(socket: Socket, frame: Uint8Array): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  socket.write(frame, (err?: Error | null) => {
    if (err) {
      reject(err);
    } else {
      resolve();
    }
  });

  return promise;
}
