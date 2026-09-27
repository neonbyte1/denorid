import type { Pattern } from "@denorid/core/microservices";
import { ClientProxy, serializePattern } from "@denorid/core/microservices";
import net, { type Socket } from "node:net";
import { decodeFrame, encodeFrame, readFrames, writeFrame } from "./_codec.ts";
import { TcpDeserializer } from "./deserializer.ts";
import type { TcpOptions } from "./options.ts";
import { TcpSerializer } from "./serializer.ts";

interface TcpResponseFrame {
  id: string;
  isDisposed: true;
  response?: unknown;
  err?: string;
}

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Microservice client proxy using TCP sockets from `node:net`, which works
 * on Deno, Bun and Node.js.
 *
 * Maintains a single persistent connection and multiplexes concurrent requests
 * via a correlation-ID map. Reconnects automatically on first use after closure.
 */
export class TcpClient extends ClientProxy {
  private socket?: Socket;
  private readLoopPromise?: Promise<void>;
  private readonly pending: Map<string, PendingEntry> = new Map();
  private connecting?: Promise<void>;
  private readonly serializer = new TcpSerializer();
  private readonly deserializer = new TcpDeserializer();

  /**
   * @param {TcpOptions} options - TCP client configuration.
   */
  public constructor(private readonly options: TcpOptions) {
    super();
  }

  /**
   * @inheritdoc
   */
  public override async connect(): Promise<void> {
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.doConnect();

    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  /**
   * @inheritdoc
   */
  public override async close(): Promise<void> {
    const err = new Error("Connection closed");

    for (const entry of this.pending.values()) {
      entry.reject(err);
    }

    this.pending.clear();
    this.socket?.destroy();
    this.socket = undefined;

    if (this.readLoopPromise) {
      await this.readLoopPromise;
      this.readLoopPromise = undefined;
    }
  }

  /** Called by the DI container on application shutdown. */
  public async onBeforeApplicationShutdown(): Promise<void> {
    await this.close();
  }

  /**
   * @inheritdoc
   */
  public override async send<T = unknown>(
    pattern: Pattern,
    data: unknown,
  ): Promise<T> {
    await this.ensureConnected();

    const id = crypto.randomUUID();
    const serialized = serializePattern(pattern);

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      writeFrame(
        this.socket!,
        encodeFrame({ pattern: serialized, data, id }, this.serializer),
      ).catch(
        (err) => {
          this.pending.delete(id);
          reject(err);
        },
      );
    });
  }

  /**
   * @inheritdoc
   */
  public override async emit(pattern: Pattern, data: unknown): Promise<void> {
    await this.ensureConnected();
    await writeFrame(
      this.socket!,
      encodeFrame(
        { pattern: serializePattern(pattern), data },
        this.serializer,
      ),
    );
  }

  private async doConnect(): Promise<void> {
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 3000;
    const attempts = this.options.retryAttempts ?? 0;
    const delay = this.options.retryDelay ?? 1000;

    let lastErr: unknown;

    for (let i = 0; i <= attempts; i++) {
      try {
        const connected = Promise.withResolvers<Socket>();
        const socket = net.connect({ host, port });

        // Stays attached after connecting: later socket errors surface
        // through `readFrames` / `writeFrame`, this listener only keeps an
        // unhandled `error` event from crashing the process.
        socket.on("error", connected.reject);
        socket.once("connect", () => connected.resolve(socket));
        this.socket = await connected.promise;
        this.readLoopPromise = this.readLoop();
        return;
      } catch (err) {
        lastErr = err;
        if (i < attempts) {
          await new Promise<void>((res) => setTimeout(res, delay));
        }
      }
    }

    throw lastErr;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.socket) {
      await this.connect();
    }
  }

  private async readLoop(): Promise<void> {
    const socket = this.socket!;

    try {
      for await (const body of readFrames(socket)) {
        let frame: TcpResponseFrame;

        try {
          frame = decodeFrame(body, this.deserializer) as TcpResponseFrame;
        } catch {
          continue;
        }

        const entry = this.pending.get(frame.id);

        if (!entry) {
          continue;
        }

        this.pending.delete(frame.id);

        if (frame.err !== undefined) {
          entry.reject(new Error(frame.err));
        } else {
          entry.resolve(frame.response);
        }
      }
    } catch {
      // Oversized frame: the byte stream cannot be resynchronised.
    } finally {
      const err = new Error("Connection closed");

      for (const entry of this.pending.values()) {
        entry.reject(err);
      }

      this.pending.clear();
      socket.destroy();
      this.socket = undefined;
    }
  }
}
