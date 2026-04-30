import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { mockStdWrite } from "./_test_utils.ts";

describe("mockStdWrite()", () => {
  it("mocks sync and async writes and restores the original methods", async () => {
    const originalWriteSync = (_buf: Uint8Array): number => 0;
    const originalWrite = (_buf: Uint8Array): Promise<number> =>
      Promise.resolve(0);
    const writable = {
      writeSync: originalWriteSync,
      write: originalWrite,
    };
    const restore = mockStdWrite(writable as typeof Deno.stdout);
    const data = new Uint8Array([1, 2, 3]);

    assertEquals(writable.writeSync(data), 3);
    assertEquals(await writable.write(data), 3);

    restore();

    assertEquals(writable.writeSync, originalWriteSync);
    assertEquals(writable.write, originalWrite);
  });
});
