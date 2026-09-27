import net, { type Server as NetServer, type Socket } from "node:net";
import { Server } from "../server.ts";
import { decodeFrame, encodeFrame, readFrames, writeFrame } from "./_codec.ts";
import { TcpDeserializer } from "./deserializer.ts";
import type { TcpOptions } from "./options.ts";
import { TcpSerializer } from "./serializer.ts";

/** Inbound frame for a request-response message (carries `id`). */
interface TcpMessageFrame {
  pattern: string;
  data: unknown;
  id: string;
}

/** Inbound frame for a fire-and-forget event (no `id`). */
interface TcpEventFrame {
  pattern: string;
  data: unknown;
}

type TcpInboundFrame = TcpMessageFrame | TcpEventFrame;

/** Outbound frame sent back to the client after handling a message. */
interface TcpResponseFrame {
  id: string;
  isDisposed: true;
  response?: unknown;
  err?: string;
}

function isMessageFrame(frame: TcpInboundFrame): frame is TcpMessageFrame {
  return "id" in frame;
}

/** The `err` text sent to the client for a thrown value. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Stops `server` from accepting connections.
 *
 * @param {NetServer} server - The server to close.
 * @return {Promise<void>} Resolves once the server released its port and every
 * connection it accepted closed. A server that is not bound (the bind failed
 * or was cancelled) resolves right away.
 */
function release(server: NetServer): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();

  // The callback gets `ERR_SERVER_NOT_RUNNING` for a server that is not bound,
  // which still means it is released.
  server.close(() => resolve());

  return promise;
}

/**
 * Microservice server using TCP sockets from `node:net`, which works on Deno,
 * Bun and Node.js.
 *
 * Messages are length-prefixed MessagePack frames:
 * - Request: `{ pattern, data, id }` - responds with `{ id, isDisposed, response? }`
 *   (`response` is omitted when the handler returned `undefined`) or
 *   `{ id, isDisposed, err }`.
 * - Event:   `{ pattern, data }` - fire-and-forget, no response sent.
 *
 * Frames received on one connection are handled concurrently, so responses
 * may arrive in any order; clients match them by `id`.
 */
export class TcpServer extends Server<TcpOptions> {
  private netServer?: NetServer;
  /** Open connections with the message and event handlers still running on each. */
  private readonly connections: Map<Socket, Set<Promise<void>>> = new Map();
  private readonly serializer = new TcpSerializer();
  private readonly deserializer = new TcpDeserializer();

  /**
   * Starts listening. Once listening, the server serves connections until
   * {@link close} is called; later server errors are logged.
   *
   * @return {Promise<void>} Resolves once the server accepts connections (or
   * once {@link close} stopped the pending start), rejects when binding fails,
   * after the server was released.
   */
  public override async listen(): Promise<void> {
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 3000;
    // Half-open: a client that ends its side after sending still receives
    // every response; `handleConnection` closes the socket once drained.
    const server = net.createServer(
      { allowHalfOpen: true },
      (socket: Socket) => this.handleConnection(server, socket),
    );
    const ready = Promise.withResolvers<void>();
    let listening = false;

    this.netServer = server;

    // Stays attached: an `error` event nobody listens to crashes the process.
    server.on("error", (err: Error) => {
      if (listening) {
        this.logger.error("TCP server error", err);
      } else {
        ready.reject(err);
      }
    });
    // `close()` before the socket is bound cancels the bind: neither
    // `listening` nor `error` follows then, only `close`.
    server.once("close", () => ready.resolve());
    server.listen(port, host, () => {
      listening = true;
      ready.resolve();
    });

    try {
      await ready.promise;
    } catch (err) {
      this.netServer = undefined;
      await release(server);
      throw err;
    }

    // `close()` started meanwhile and releases the server.
    if (this.netServer !== server) {
      return;
    }

    this.logger.log(`TCP server listening on ${host}:${port}`);
  }

  /**
   * Stops accepting connections and dispatching newly received frames, waits
   * until every running handler finished and wrote its response, then
   * destroys every open connection and waits until the listening socket is
   * released. Safe to call before, during and after {@link listen}.
   *
   * @return {Promise<void>}
   */
  public override async close(): Promise<void> {
    const server = this.netServer;

    // Connections stop dispatching once their server is no longer current.
    this.netServer = undefined;

    const released = server && release(server);

    await Promise.allSettled(
      [...this.connections.values()].flatMap((inFlight) => [...inFlight]),
    );

    for (const socket of this.connections.keys()) {
      socket.destroy();
    }

    await released;
  }

  private async handleConnection(
    server: NetServer,
    socket: Socket,
  ): Promise<void> {
    const inFlight = new Set<Promise<void>>();

    this.connections.set(socket, inFlight);

    // Read errors end `readFrames` and write errors reject `writeFrame`; this
    // listener only keeps an unhandled `error` event from crashing the process.
    socket.on("error", () => {});

    try {
      for await (
        const body of readFrames(socket, this.options.maxBufferSize)
      ) {
        if (this.netServer !== server) {
          break; // `close()` started
        }

        let frame: TcpInboundFrame;

        try {
          frame = decodeFrame(body, this.deserializer) as TcpInboundFrame;
        } catch {
          break;
        }

        // Not awaited, so a slow handler does not hold up the frames behind
        // it. Each response is a single write, so frames never interleave.
        const handling = isMessageFrame(frame)
          ? this.handleMessage(socket, frame)
          : this.handleEvent(frame);

        inFlight.add(handling);
        handling.finally(() => inFlight.delete(handling));
      }
    } catch {
      // Oversized frame: the byte stream cannot be resynchronised.
    } finally {
      // Every request received so far is answered before the socket closes,
      // which also serves half-open clients that ended their side.
      await Promise.allSettled(inFlight);
      this.connections.delete(socket);
      socket.destroy();
    }
  }

  private async handleMessage(
    socket: Socket,
    frame: TcpMessageFrame,
  ): Promise<void> {
    const reply: TcpResponseFrame = { id: frame.id, isDisposed: true };

    try {
      const response = await this.dispatch(frame.pattern, frame.data);

      // MessagePack cannot encode `undefined`; the client reads the absent
      // field back as `undefined`.
      if (response !== undefined) {
        reply.response = response;
      }
    } catch (err) {
      reply.err = errorText(err);
    }

    let bytes: Uint8Array;

    try {
      bytes = encodeFrame(reply, this.serializer);
    } catch (err) {
      this.logger.error(
        `Failed to serialize the response for pattern "${frame.pattern}"`,
        err,
      );

      const failure: TcpResponseFrame = {
        id: frame.id,
        isDisposed: true,
        err: `Failed to serialize response: ${errorText(err)}`,
      };

      bytes = encodeFrame(failure, this.serializer);
    }

    try {
      await writeFrame(socket, bytes);
    } catch {
      // connection may have closed before we could respond
    }
  }

  private async handleEvent(frame: TcpEventFrame): Promise<void> {
    try {
      await this.dispatch(frame.pattern, frame.data);
    } catch {
      // errors logged/handled inside dispatch()
    }
  }
}
