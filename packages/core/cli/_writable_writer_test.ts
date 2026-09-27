import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { describe, it } from "node:test";
import { toConsoleWriter, type WritableLike } from "./_writable_writer.ts";

class DeferredWritable implements WritableLike {
  public readonly chunks: Uint8Array[] = [];
  private readonly callbacks: ((error?: Error | null) => void)[] = [];

  public write(
    chunk: Uint8Array,
    callback: (error?: Error | null) => void,
  ): boolean {
    this.chunks.push(chunk);
    this.callbacks.push(callback);
    return true;
  }

  public flush(error?: Error | null): void {
    this.callbacks.shift()?.(error);
  }
}

describe(toConsoleWriter.name, () => {
  it("forwards the bytes and resolves with their length only once the stream acknowledged them", async () => {
    const stream = new DeferredWritable();
    const writer = toConsoleWriter(stream);
    const bytes = new TextEncoder().encode("héllo");
    let settled = false;

    const pending = Promise.resolve(writer.write(bytes)).then(
      (written: number): number => {
        settled = true;
        return written;
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    assertEquals(settled, false);
    assertEquals(stream.chunks, [bytes]);

    stream.flush(null);

    assertEquals(await pending, 6);
  });

  it("resolves when the stream acknowledges without passing an error argument", async () => {
    const stream = new DeferredWritable();
    const writer = toConsoleWriter(stream);

    const pending = writer.write(new Uint8Array([1, 2, 3]));
    stream.flush();

    assertEquals(await pending, 3);
  });

  it("rejects with the error reported by the stream", async () => {
    const stream = new DeferredWritable();
    const writer = toConsoleWriter(stream);
    const failure = new Error("EPIPE");

    const pending = Promise.resolve(writer.write(new Uint8Array([1])));
    stream.flush(failure);

    const error = await assertRejects(() => pending);
    assertStrictEquals(error, failure);
  });
});
