import { assertEquals, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { decodeFrame, encodeFrame, readFrame } from "./_codec.ts";
import { TcpDeserializer } from "./deserializer.ts";
import { TcpSerializer } from "./serializer.ts";

function makeMockConn(
  chunks: Array<Uint8Array | null | Error>,
): Deno.TcpConn {
  let idx = 0;
  return {
    read: (p: Uint8Array): Promise<number | null> => {
      if (idx >= chunks.length) return Promise.resolve(null);
      const chunk = chunks[idx++];
      if (chunk instanceof Error) return Promise.reject(chunk);
      if (chunk === null) return Promise.resolve(null);
      const n = Math.min(chunk.length, p.length);
      p.set(chunk.subarray(0, n));
      return Promise.resolve(n);
    },
  } as unknown as Deno.TcpConn;
}

const serializer = new TcpSerializer();
const deserializer = new TcpDeserializer();

describe("encodeFrame", () => {
  it("produces a 4-byte length prefix followed by the serialized body", () => {
    const encoded = encodeFrame({ hello: "world" }, serializer);
    const view = new DataView(encoded.buffer);
    const length = view.getUint32(0, false);
    assertEquals(length, encoded.byteLength - 4);
  });
});

describe("decodeFrame", () => {
  it("round-trips with encodeFrame", () => {
    const value = { x: 42, y: "test" };
    const encoded = encodeFrame(value, serializer);
    assertEquals(decodeFrame(encoded.subarray(4), deserializer), value);
  });
});

describe("readFrame", () => {
  it("returns null on immediate EOF", async () => {
    assertEquals(await readFrame(makeMockConn([null])), null);
  });

  it("returns null when header read throws", async () => {
    assertEquals(
      await readFrame(makeMockConn([new Error("connection reset")])),
      null,
    );
  });

  it("returns null on partial header then EOF", async () => {
    assertEquals(
      await readFrame(makeMockConn([new Uint8Array([0, 0]), null])),
      null,
    );
  });

  it("throws RangeError when declared length exceeds 64 MiB", async () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 64 * 1024 * 1024 + 1, false);
    await assertRejects(
      () => readFrame(makeMockConn([header])),
      RangeError,
      "Frame too large",
    );
  });

  it("reads a complete frame delivered in two chunks", async () => {
    const value = { test: 123 };
    const encoded = encodeFrame(value, serializer);
    const conn = makeMockConn([encoded.subarray(0, 4), encoded.subarray(4)]);
    const body = await readFrame(conn);
    assertEquals(decodeFrame(body!, deserializer), value);
  });

  it("reassembles body delivered byte-by-byte", async () => {
    const value = { test: 456 };
    const encoded = encodeFrame(value, serializer);
    const header = encoded.subarray(0, 4);
    const bodyChunks = Array.from(encoded.subarray(4)).map(
      (b) => new Uint8Array([b]),
    );
    const body = await readFrame(makeMockConn([header, ...bodyChunks]));
    assertEquals(decodeFrame(body!, deserializer), value);
  });

  it("returns null when body read returns null (partial body)", async () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 10, false);
    assertEquals(
      await readFrame(makeMockConn([header, new Uint8Array([1, 2]), null])),
      null,
    );
  });

  it("returns null when body read throws (connection error mid-body)", async () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 10, false);
    assertEquals(
      await readFrame(makeMockConn([header, new Error("mid-body error")])),
      null,
    );
  });
});
