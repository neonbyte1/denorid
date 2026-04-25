import { Server } from "../server.ts";
import { decodeFrame, encodeFrame, readFrame } from "./_codec.ts";
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
 * Microservice server using Deno-native TCP (`Deno.listen`).
 *
 * Messages are newline-delimited JSON frames:
 * - Request: `{"pattern":"...","data":{},"id":"<uuid>"}` - responds with result.
 * - Event:   `{"pattern":"...","data":{}}` - fire-and-forget, no response sent.
 */
export class TcpServer extends Server<TcpOptions> {
  private listener?: Deno.TcpListener;
  private readonly connections: Set<Deno.TcpConn> = new Set();
  private readonly serializer = new TcpSerializer();
  private readonly deserializer = new TcpDeserializer();

  public override async listen(): Promise<void> {
    const hostname = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 3000;

    this.listener = Deno.listen({ hostname, port });

    this.logger.log(`TCP server listening on ${hostname}:${port}`);

    for await (const conn of this.listener) {
      this.connections.add(conn);

      this.handleConnection(conn).finally(() => {
        this.connections.delete(conn);
      });
    }
  }

  public override async close(): Promise<void> {
    this.listener?.close();
    this.listener = undefined;
    this.connections.clear();
    await Promise.resolve();
  }

  private async handleConnection(conn: Deno.TcpConn): Promise<void> {
    try {
      while (true) {
        const body = await readFrame(conn);

        if (body === null) {
          break;
        }

        let frame: TcpInboundFrame;

        try {
          frame = decodeFrame(body, this.deserializer) as TcpInboundFrame;
        } catch {
          break;
        }

        if (isMessageFrame(frame)) {
          await this.handleMessage(conn, frame);
        } else {
          this.handleEvent(frame);
        }
      }
    } finally {
      try {
        conn.close();
      } catch {
        // already closed
      }
    }
  }

  private async handleMessage(
    conn: Deno.TcpConn,
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
      await conn.write(encodeFrame(responseFrame, this.serializer));
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
