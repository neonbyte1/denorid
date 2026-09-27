import { assertEquals } from "@std/assert";
import { describe, it } from "node:test";
import { mockStdWrite } from "./_test_utils.ts";

class RecordingStream {
  public readonly chunks: string[] = [];

  public write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
}

describe("mockStdWrite()", () => {
  it("swallows writes until restored", () => {
    const stream = new RecordingStream();
    const restore = mockStdWrite(stream);

    assertEquals(stream.write("silenced"), true);
    assertEquals(stream.chunks, []);

    restore();
    stream.write("visible");

    assertEquals(stream.chunks, ["visible"]);
  });

  it("restores an inherited write method without leaving an own property", () => {
    const stream = new RecordingStream();
    const restore = mockStdWrite(stream);

    assertEquals(Object.hasOwn(stream, "write"), true);

    restore();

    assertEquals(Object.hasOwn(stream, "write"), false);
    assertEquals(stream.write, RecordingStream.prototype.write);
  });
});
