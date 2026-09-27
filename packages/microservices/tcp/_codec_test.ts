import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { once } from "node:events";
import net, { type AddressInfo, type Socket } from "node:net";
import { describe, it } from "node:test";
import {
  decodeFrame,
  encodeFrame,
  FrameDecoder,
  readFrames,
  writeFrame,
} from "./_codec.ts";
import { TcpDeserializer } from "./deserializer.ts";
import { TcpSerializer } from "./serializer.ts";

const serializer = new TcpSerializer();
const deserializer = new TcpDeserializer();

function header(length: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, length, false);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }

  return out;
}

async function* chunksOf(
  items: Array<Uint8Array | Error>,
): AsyncGenerator<Uint8Array, void, undefined> {
  for (const item of items) {
    if (item instanceof Error) {
      throw item;
    }

    yield item;
  }
}

async function collect(
  frames: AsyncIterable<Uint8Array>,
): Promise<unknown[]> {
  const values: unknown[] = [];

  for await (const body of frames) {
    values.push(decodeFrame(body, deserializer));
  }

  return values;
}

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

describe(FrameDecoder.name, () => {
  it("emits nothing until the header and body are complete", () => {
    const encoded = encodeFrame({ test: 123 }, serializer);
    const decoder = new FrameDecoder();

    assertEquals(decoder.push(encoded.subarray(0, 2)), []);
    assertEquals(decoder.push(encoded.subarray(2, 6)), []);

    const frames = decoder.push(encoded.subarray(6));

    assertEquals(frames.length, 1);
    assertEquals(decodeFrame(frames[0], deserializer), { test: 123 });
  });

  it("reassembles a body delivered byte-by-byte", () => {
    const encoded = encodeFrame({ test: 456 }, serializer);
    const decoder = new FrameDecoder();
    const frames = Array.from(encoded).flatMap((byte) =>
      decoder.push(new Uint8Array([byte]))
    );

    assertEquals(frames.length, 1);
    assertEquals(decodeFrame(frames[0], deserializer), { test: 456 });
  });

  it("splits several frames delivered in one chunk and keeps the remainder", () => {
    const a = encodeFrame("a", serializer);
    const b = encodeFrame("b", serializer);
    const c = encodeFrame("c", serializer);
    const decoder = new FrameDecoder();

    const first = decoder.push(concat(a, b, c.subarray(0, 5)));
    const second = decoder.push(c.subarray(5));

    assertEquals(
      first.map((body) => decodeFrame(body, deserializer)),
      ["a", "b"],
    );
    assertEquals(
      second.map((body) => decodeFrame(body, deserializer)),
      ["c"],
    );
  });

  it("emits an empty body for a zero-length frame", () => {
    const next = encodeFrame("next", serializer);
    const frames = new FrameDecoder().push(concat(header(0), next));

    assertEquals(frames.length, 2);
    assertEquals(frames[0], new Uint8Array(0));
    assertEquals(decodeFrame(frames[1], deserializer), "next");
  });

  it("copies bodies so reusing the source chunk does not corrupt them", () => {
    const chunk = encodeFrame("stable", serializer);
    const [body] = new FrameDecoder().push(chunk);

    chunk.fill(0);

    assertEquals(decodeFrame(body, deserializer), "stable");
  });

  it("accepts a declared length of exactly 64 MiB", () => {
    assertEquals(new FrameDecoder().push(header(64 * 1024 * 1024)), []);
  });

  it("throws RangeError when declared length exceeds 64 MiB", () => {
    assertThrows(
      () => new FrameDecoder().push(header(64 * 1024 * 1024 + 1)),
      RangeError,
      "Frame too large: 67108865 bytes",
    );
  });
});

describe(readFrames.name, () => {
  it("yields every frame regardless of chunk boundaries until EOF", async () => {
    const stream = concat(
      encodeFrame({ n: 1 }, serializer),
      encodeFrame({ n: 2 }, serializer),
      encodeFrame({ n: 3 }, serializer),
    );

    assertEquals(
      await collect(
        readFrames(
          chunksOf([
            stream.subarray(0, 3),
            stream.subarray(3, 20),
            stream.subarray(20),
          ]),
        ),
      ),
      [{ n: 1 }, { n: 2 }, { n: 3 }],
    );
  });

  it("discards a trailing partial frame at EOF", async () => {
    const complete = encodeFrame("done", serializer);

    assertEquals(
      await collect(
        readFrames(chunksOf([complete, header(10), new Uint8Array([1, 2])])),
      ),
      ["done"],
    );
  });

  it("ends like EOF when the source fails", async () => {
    const complete = encodeFrame("before", serializer);

    assertEquals(
      await collect(
        readFrames(chunksOf([complete, new Error("connection reset")])),
      ),
      ["before"],
    );
  });

  it("propagates RangeError for oversized frames", async () => {
    await assertRejects(
      () => collect(readFrames(chunksOf([header(64 * 1024 * 1024 + 1)]))),
      RangeError,
      "Frame too large",
    );
  });
});

describe(writeFrame.name, () => {
  it("delivers frames over a real socket that readFrames decodes", async () => {
    const accepted = Promise.withResolvers<Socket>();
    const server = net.createServer(accepted.resolve);

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const { port } = server.address() as AddressInfo;
    const client = net.connect({ host: "127.0.0.1", port });
    const peer = await accepted.promise;

    try {
      await writeFrame(client, encodeFrame({ n: 1 }, serializer));
      await writeFrame(client, encodeFrame({ n: 2 }, serializer));
      client.end();

      assertEquals(await collect(readFrames(peer)), [{ n: 1 }, { n: 2 }]);
    } finally {
      client.destroy();
      peer.destroy();
      server.close();
      await once(server, "close");
    }
  });

  it("rejects when the socket cannot be written to", async () => {
    const socket = new net.Socket();

    socket.destroy();

    await assertRejects(
      () => writeFrame(socket, encodeFrame("lost", serializer)),
      Error,
    );
  });
});
