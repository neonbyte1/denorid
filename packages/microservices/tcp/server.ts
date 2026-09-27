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

/**
 * Microservice server using TCP sockets from `node:net`, which works on Deno,
 * Bun and Node.js.
 *
 * Messages are length-prefixed MessagePack frames:
 * - Request: `{ pattern, data, id }` - responds with `{ id, isDisposed, response | err }`.
 * - Event:   `{ pattern, data }` - fire-and-forget, no response sent.
 */
export class TcpServer extends Server<TcpOptions> {
  private netServer?: NetServer;
  private readonly sockets: Set<Socket> = new Set();
  private readonly serializer = new TcpSerializer();
  private readonly deserializer = new TcpDeserializer();

  /**
   * Starts listening and serves connections until {@link close} is called.
   *
   * @return {Promise<void>} Resolves once the server was closed, rejects when binding or accepting fails.
   */
  public override async listen(): Promise<void> {
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 3000;
    // Half-open: a client that ends its side after sending still receives
    // every response; `handleConnection` closes the socket once drained.
    const server = net.createServer(
      { allowHalfOpen: true },
      (socket: Socket) => this.handleConnection(socket),
    );

    this.netServer = server;

    const stopped = Promise.withResolvers<void>();

    server.on("error", stopped.reject);
    server.once("close", stopped.resolve);
    server.listen(port, host, () => {
      this.logger.log(`TCP server listening on ${host}:${port}`);
    });

    await stopped.promise;
  }

  /**
   * Stops accepting connections, destroys every open connection and waits
   * until the listening socket is released.
   *
   * @return {Promise<void>}
   */
  public override async close(): Promise<void> {
    const server = this.netServer;

    this.netServer = undefined;

    for (const socket of this.sockets) {
      socket.destroy();
    }

    this.sockets.clear();

    if (server) {
      const closed = Promise.withResolvers<void>();

      // Called with `ERR_SERVER_NOT_RUNNING` when `listen()` failed to bind,
      // which still means the server is released.
      server.close(() => closed.resolve());
      await closed.promise;
    }
  }

  private async handleConnection(socket: Socket): Promise<void> {
    this.sockets.add(socket);

    // Read errors end `readFrames` and write errors reject `writeFrame`; this
    // listener only keeps an unhandled `error` event from crashing the process.
    socket.on("error", () => {});

    try {
      for await (const body of readFrames(socket)) {
        let frame: TcpInboundFrame;

        try {
          frame = decodeFrame(body, this.deserializer) as TcpInboundFrame;
        } catch {
          break;
        }

        if (isMessageFrame(frame)) {
          await this.handleMessage(socket, frame);
        } else {
          this.handleEvent(frame);
        }
      }
    } catch {
      // Oversized frame: the byte stream cannot be resynchronised.
    } finally {
      this.sockets.delete(socket);
      socket.destroy();
    }
  }

  private async handleMessage(
    socket: Socket,
    frame: TcpMessageFrame,
  ): Promise<void> {
    let responseFrame: TcpResponseFrame;

    try {
      const response = await this.dispatch(frame.pattern, frame.data);
      responseFrame = { id: frame.id, isDisposed: true, response };
    } catch (err) {
      responseFrame = {
        id: frame.id,
        isDisposed: true,
        err: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      await writeFrame(socket, encodeFrame(responseFrame, this.serializer));
    } catch {
      // connection may have closed before we could respond
    }
  }

  private handleEvent(frame: TcpEventFrame): void {
    this.dispatch(frame.pattern, frame.data).catch(() => {
      // errors logged/handled inside dispatch()
    });
  }
}
