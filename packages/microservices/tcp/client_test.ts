import { assertEquals, assertRejects } from "@std/assert";
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { mockStdWrite, type RestoreFn } from "../_test_utils.ts";
import { encodeFrame } from "./_codec.ts";
import { TcpClient } from "./client.ts";
import { TcpSerializer } from "./serializer.ts";

const serializer = new TcpSerializer();

function buildResponseFrame(id: string, response: unknown): Uint8Array {
  return encodeFrame({ id, isDisposed: true, response }, serializer);
}

function buildErrFrame(id: string, err: string): Uint8Array {
  return encodeFrame({ id, isDisposed: true, err }, serializer);
}

/**
 * Creates a mock TcpConn backed by a preloaded queue of read chunks.
 * No polling timers - reads resolve immediately from the queue.
 */
function makeMockConn(opts: {
  readChunks?: Array<Uint8Array | null | Error>;
  onWrite?: (buf: Uint8Array) => Promise<void> | void;
} = {}): Deno.TcpConn {
  const chunks = opts.readChunks ?? [null];
  let readIdx = 0;

  return {
    read: (p: Uint8Array): Promise<number | null> => {
      if (readIdx >= chunks.length) return Promise.resolve(null);
      const chunk = chunks[readIdx++];
      if (chunk instanceof Error) return Promise.reject(chunk);
      if (chunk === null) return Promise.resolve(null);
      const n = Math.min(chunk.length, p.length);
      p.set(chunk.subarray(0, n));
      return Promise.resolve(n);
    },
    write: async (buf: Uint8Array): Promise<number> => {
      await opts.onWrite?.(buf);
      return buf.byteLength;
    },
    close: () => {},
  } as unknown as Deno.TcpConn;
}

describe("TcpClient", () => {
  let restoreStdout: RestoreFn;
  let restoreStderr: RestoreFn;

  beforeAll(() => {
    restoreStdout = mockStdWrite(Deno.stdout);
    restoreStderr = mockStdWrite(Deno.stderr);
  });

  afterAll(() => {
    restoreStdout();
    restoreStderr();
  });

  describe("connect()", () => {
    it("connects successfully", async () => {
      const conn = makeMockConn();
      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({ host: "127.0.0.1", port: 9999 });
      await client.connect();
      await client.close();
    });

    it("concurrent connect() calls resolve to the same connection", async () => {
      let connectCalls = 0;
      const conn = makeMockConn();
      using _s = stub(
        Deno,
        "connect",
        (() => {
          connectCalls++;
          return Promise.resolve(conn);
        }) as never,
      );

      const client = new TcpClient({});
      await Promise.all([client.connect(), client.connect()]);
      assertEquals(connectCalls, 1);
      await client.close();
    });

    it("retries on failure and eventually throws", async () => {
      let attempts = 0;
      using _s = stub(
        Deno,
        "connect",
        (() => {
          attempts++;
          return Promise.reject(new Error("refused"));
        }) as never,
      );

      const client = new TcpClient({ retryAttempts: 2, retryDelay: 1 });
      await assertRejects(() => client.connect(), Error, "refused");
      assertEquals(attempts, 3); // 1 initial + 2 retries
    });

    it("uses default host and port when options are empty", async () => {
      let capturedOpts!: Deno.ConnectOptions;
      const conn = makeMockConn();
      using _s = stub(
        Deno,
        "connect",
        ((opts: Deno.ConnectOptions) => {
          capturedOpts = opts;
          return Promise.resolve(conn);
        }) as never,
      );

      const client = new TcpClient({});
      await client.connect();
      await client.close();

      assertEquals(capturedOpts.hostname, "127.0.0.1");
      assertEquals(capturedOpts.port, 3000);
    });
  });

  describe("close()", () => {
    it("is a no-op when not connected", async () => {
      const client = new TcpClient({});
      await client.close();
    });

    it("swallows conn.close() error", async () => {
      let unblock!: () => void;
      const blockPromise = new Promise<void>((r) => {
        unblock = r;
      });
      const conn = {
        read: (): Promise<number | null> => blockPromise.then(() => null),
        write: (buf: Uint8Array): Promise<number> =>
          Promise.resolve(buf.byteLength),
        close: () => {
          unblock();
          throw new Error("already closed");
        },
      } as unknown as Deno.TcpConn;

      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({});
      await client.connect();
      await client.close(); // must not throw despite conn.close() throwing
    });
  });

  describe("send()", () => {
    it("rejects when write fails", async () => {
      let unblock!: () => void;
      const blockPromise = new Promise<void>((r) => {
        unblock = r;
      });
      const conn = {
        read: (): Promise<number | null> => blockPromise.then(() => null),
        write: (): Promise<number> => Promise.reject(new Error("write failed")),
        close: () => {
          unblock();
        },
      } as unknown as Deno.TcpConn;

      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({});
      await client.connect();
      await assertRejects(() => client.send("pat", {}), Error, "write failed");
      await client.close();
    });

    it("auto-connects when not yet connected before sending", async () => {
      let connectCalled = false;
      const conn = makeMockConn();
      using _s = stub(
        Deno,
        "connect",
        (() => {
          connectCalled = true;
          return Promise.resolve(conn);
        }) as never,
      );

      const client = new TcpClient({});
      const p = client.send("x", null).catch(() => {});
      await new Promise<void>((r) => setTimeout(r, 5));
      await client.close();
      await p;
      assertEquals(connectCalled, true);
    });
  });

  describe("emit()", () => {
    it("writes an event frame without waiting for a response", async () => {
      let written = false;
      let unblock!: () => void;
      const blockPromise = new Promise<void>((r) => {
        unblock = r;
      });
      const conn = {
        read: (): Promise<number | null> => blockPromise.then(() => null),
        write: (buf: Uint8Array): Promise<number> => {
          written = true;
          return Promise.resolve(buf.byteLength);
        },
        close: () => {
          unblock();
        },
      } as unknown as Deno.TcpConn;
      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({});
      await client.connect();
      await client.emit("event.fired", { payload: 1 });
      await client.close();

      assertEquals(written, true);
    });

    it("auto-connects when not yet connected for emit", async () => {
      let unblock!: () => void;
      const blockPromise = new Promise<void>((r) => {
        unblock = r;
      });
      const conn = {
        read: (): Promise<number | null> => blockPromise.then(() => null),
        write: (buf: Uint8Array): Promise<number> =>
          Promise.resolve(buf.byteLength),
        close: () => {
          unblock();
        },
      } as unknown as Deno.TcpConn;
      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({});
      await client.emit("evt", {});
      await client.close();
    });
  });

  describe("onBeforeApplicationShutdown()", () => {
    it("calls close()", async () => {
      const conn = makeMockConn();
      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({});
      await client.connect();
      await (client as unknown as {
        onBeforeApplicationShutdown(): Promise<void>;
      })
        .onBeforeApplicationShutdown();
    });
  });

  describe("readLoop - response frame routing", () => {
    it("resolves pending send when matching response arrives", async () => {
      let capturedId = "";
      const pendingReads: Array<(p: Uint8Array) => void> = [];

      const conn: Deno.TcpConn = {
        write: async (buf: Uint8Array): Promise<number> => {
          const { decode } = await import("@std/msgpack");
          const msg = decode(buf.subarray(4)) as { id: string };
          capturedId = msg.id;
          return buf.byteLength;
        },
        close: () => {},
        read: (p: Uint8Array): Promise<number | null> => {
          return new Promise((resolve) => {
            pendingReads.push((chunk: Uint8Array | null) => {
              if (chunk === null) {
                resolve(null);
                return;
              }
              const n = Math.min(chunk.length, p.length);
              p.set(chunk.subarray(0, n));
              resolve(n);
            });
          });
        },
      } as unknown as Deno.TcpConn;

      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({});
      await client.connect();

      const sendPromise = client.send<string>("greet", "world");

      // Wait for write to be captured
      await new Promise<void>((r) => setTimeout(r, 10));

      const responseFrame = buildResponseFrame(capturedId, "hello!");
      const header = responseFrame.subarray(0, 4);
      const body = responseFrame.subarray(4);

      // Feed: header → body → EOF
      const pop = () => pendingReads.shift()!;
      pop()(header);
      await new Promise<void>((r) => setTimeout(r, 5));
      pop()(body);
      await new Promise<void>((r) => setTimeout(r, 5));
      pop()(null as unknown as Uint8Array); // EOF terminates loop

      const result = await sendPromise;
      assertEquals(result, "hello!");
      await client.close();
    });

    it("rejects pending send when response has err field", async () => {
      let capturedId = "";
      const pendingReads: Array<(chunk: Uint8Array | null) => void> = [];

      const conn: Deno.TcpConn = {
        write: async (buf: Uint8Array): Promise<number> => {
          const { decode } = await import("@std/msgpack");
          capturedId = (decode(buf.subarray(4)) as { id: string }).id;
          return buf.byteLength;
        },
        close: () => {},
        read: (p: Uint8Array): Promise<number | null> => {
          return new Promise((resolve) => {
            pendingReads.push((chunk) => {
              if (chunk === null) {
                resolve(null);
                return;
              }
              const n = Math.min(chunk.length, p.length);
              p.set(chunk.subarray(0, n));
              resolve(n);
            });
          });
        },
      } as unknown as Deno.TcpConn;

      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({});
      await client.connect();

      const sendPromise = client.send<string>("op", {});
      await new Promise<void>((r) => setTimeout(r, 10));

      const errFrame = buildErrFrame(capturedId, "server exploded");
      const pop = () => pendingReads.shift()!;
      pop()(errFrame.subarray(0, 4));
      await new Promise<void>((r) => setTimeout(r, 5));
      pop()(errFrame.subarray(4));
      // Attach the rejection handler BEFORE yielding to microtasks that process the frame.
      const assertPromise = assertRejects(
        () => sendPromise,
        Error,
        "server exploded",
      );
      await new Promise<void>((r) => setTimeout(r, 5));
      pop()(null as unknown as Uint8Array);
      await assertPromise;
      await client.close();
    });

    it("skips corrupt frames (decode failure) and continues", async () => {
      const pendingReads: Array<(chunk: Uint8Array | null) => void> = [];

      const conn: Deno.TcpConn = {
        write: (buf: Uint8Array): Promise<number> =>
          Promise.resolve(buf.byteLength),
        close: () => {},
        read: (p: Uint8Array): Promise<number | null> => {
          return new Promise((resolve) => {
            pendingReads.push((chunk) => {
              if (chunk === null) {
                resolve(null);
                return;
              }
              const n = Math.min(chunk.length, p.length);
              p.set(chunk.subarray(0, n));
              resolve(n);
            });
          });
        },
      } as unknown as Deno.TcpConn;

      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({});
      await client.connect();

      // Invalid msgpack body
      const invalidBody = new Uint8Array([0xff, 0xff, 0xff]);
      const header = new Uint8Array(4);
      new DataView(header.buffer).setUint32(0, invalidBody.length, false);

      const pop = () => pendingReads.shift()!;
      pop()(header);
      await new Promise<void>((r) => setTimeout(r, 5));
      pop()(invalidBody);
      await new Promise<void>((r) => setTimeout(r, 5));
      pop()(null as unknown as Uint8Array); // EOF

      await client.close();
    });

    it("skips response frames with unknown correlation id", async () => {
      const pendingReads: Array<(chunk: Uint8Array | null) => void> = [];

      const conn: Deno.TcpConn = {
        write: (buf: Uint8Array): Promise<number> =>
          Promise.resolve(buf.byteLength),
        close: () => {},
        read: (p: Uint8Array): Promise<number | null> => {
          return new Promise((resolve) => {
            pendingReads.push((chunk) => {
              if (chunk === null) {
                resolve(null);
                return;
              }
              const n = Math.min(chunk.length, p.length);
              p.set(chunk.subarray(0, n));
              resolve(n);
            });
          });
        },
      } as unknown as Deno.TcpConn;

      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({});
      await client.connect();

      const frame = buildResponseFrame("unknown-id-12345", "ignored");
      const pop = () => pendingReads.shift()!;
      pop()(frame.subarray(0, 4));
      await new Promise<void>((r) => setTimeout(r, 5));
      pop()(frame.subarray(4));
      await new Promise<void>((r) => setTimeout(r, 5));
      pop()(null as unknown as Uint8Array);

      await client.close();
    });

    it("rejects pending sends when connection drops (EOF in readLoop)", async () => {
      // Use deferred reads so the readLoop stays alive until we explicitly trigger EOF.
      // Without this, the readLoop exits (setting this.conn=undefined) before send()
      // can call write(), causing a TypeError instead of "Connection closed".
      const pendingReads: Array<() => void> = [];

      const conn: Deno.TcpConn = {
        write: (buf: Uint8Array): Promise<number> =>
          Promise.resolve(buf.byteLength),
        close: () => {},
        read: (_p: Uint8Array): Promise<number | null> =>
          new Promise((resolve) => {
            pendingReads.push(() => resolve(null));
          }),
      } as unknown as Deno.TcpConn;

      using _s = stub(Deno, "connect", (() => Promise.resolve(conn)) as never);

      const client = new TcpClient({});
      await client.connect();

      const p = client.send<string>("x", null).catch((e) =>
        (e as Error).message
      );
      await new Promise<void>((r) => setTimeout(r, 10));

      // Trigger EOF - readLoop is suspended waiting for the header read
      pendingReads.shift()!();

      await new Promise<void>((r) => setTimeout(r, 10));
      const msg = await p;
      assertEquals(msg, "Connection closed");
      await client.close();
    });
  });
});
