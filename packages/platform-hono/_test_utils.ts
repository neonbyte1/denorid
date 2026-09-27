import type { WSEvents, WSReadyState } from "@hono/hono/ws";
import { WSContext } from "@hono/hono/ws";
import type { UpgradeWebSocket } from "./_serve.ts";

/**
 * Returns a port that was free a moment ago.
 *
 * @return {number} The port.
 */
export function getFreePort(): number {
  const listener = Deno.listen({ hostname: "0.0.0.0", port: 0 });
  const { port } = listener.addr;

  listener.close();

  return port;
}

/**
 * WebSocket client collecting the received text frames.
 */
export class TestWebSocket {
  private readonly received: string[] = [];
  private readonly waiting: PromiseWithResolvers<string>[] = [];
  private readonly closing: PromiseWithResolvers<CloseEvent> = Promise
    .withResolvers();

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event: MessageEvent): void => {
      const data = String(event.data);
      const waiter = this.waiting.shift();

      if (waiter === undefined) {
        this.received.push(data);
      } else {
        waiter.resolve(data);
      }
    };
    socket.onclose = (event: CloseEvent): void => this.closing.resolve(event);
  }

  /**
   * Opens a connection.
   *
   * @param {string} url - `ws://` URL.
   * @param {HeadersInit} [headers] - Extra headers of the upgrade request
   *   (Deno specific `WebSocket` option).
   * @return {Promise<TestWebSocket>} The open connection.
   * @throws {Error} When the connection fails.
   */
  public static async connect(
    url: string,
    headers?: HeadersInit,
  ): Promise<TestWebSocket> {
    const socket = new WebSocket(url, { headers });
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    socket.onopen = (): void => resolve();
    socket.onerror = (): void => reject(new Error(`Cannot connect to ${url}`));

    await promise;

    return new TestWebSocket(socket);
  }

  /**
   * Resolves with the close event once the connection closed.
   *
   * @return {Promise<CloseEvent>} The close event.
   */
  public get closed(): Promise<CloseEvent> {
    return this.closing.promise;
  }

  /**
   * Sends `message` serialized as JSON.
   *
   * @param {unknown} message - The message.
   * @return {void}
   */
  public send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  /**
   * Sends `data` as is.
   *
   * @param {string | Uint8Array<ArrayBuffer>} data - Text or binary data.
   * @return {void}
   */
  public sendRaw(data: string | Uint8Array<ArrayBuffer>): void {
    this.socket.send(data);
  }

  /**
   * Resolves with the next received text frame.
   *
   * @return {Promise<string>} The frame.
   */
  public next(): Promise<string> {
    const data = this.received.shift();

    if (data !== undefined) {
      return Promise.resolve(data);
    }

    const waiter = Promise.withResolvers<string>();

    this.waiting.push(waiter);

    return waiter.promise;
  }

  /**
   * Closes the connection.
   *
   * @return {Promise<CloseEvent>} The close event.
   */
  public close(): Promise<CloseEvent> {
    this.socket.close();

    return this.closed;
  }
}

/**
 * Hono WebSocket context recording what is sent and closed.
 */
export interface FakeSocket {
  /** The context handed to the events. */
  context: WSContext;
  /** Live state, `3` once closed. */
  raw: { readyState: WSReadyState };
  /** Sent data. */
  sent: unknown[];
  /** Arguments of every `close()` call. */
  closes: [number | undefined, string | undefined][];
}

/**
 * Creates a {@linkcode FakeSocket}.
 *
 * @param {WSReadyState} [readyState] - Initial state, defaults to open.
 * @return {FakeSocket} The socket.
 */
export function createFakeSocket(readyState: WSReadyState = 1): FakeSocket {
  const raw = { readyState };
  const sent: unknown[] = [];
  const closes: [number | undefined, string | undefined][] = [];
  const context = new WSContext({
    raw,
    readyState,
    send: (data): void => {
      sent.push(data);
    },
    close: (code, reason): void => {
      closes.push([code, reason]);
      raw.readyState = 3;
    },
  });

  return { context, raw, sent, closes };
}

/**
 * Upgrade helper recording the events of every upgraded request instead of
 * upgrading it.
 */
export interface FakeUpgrade {
  /** The helper. */
  upgradeWebSocket: UpgradeWebSocket;
  /** Events of every upgraded request. */
  connections: WSEvents[];
}

/**
 * Creates a {@linkcode FakeUpgrade} that upgrades every request with
 * `upgrade: websocket` and passes any other on.
 *
 * @return {FakeUpgrade} The helper.
 */
export function createFakeUpgrade(): FakeUpgrade {
  const connections: WSEvents[] = [];
  const upgradeWebSocket: UpgradeWebSocket = (createEvents) => (c, next) => {
    if (c.req.header("upgrade") !== "websocket") {
      return next();
    }

    connections.push(createEvents(c));

    return Promise.resolve(new Response("upgraded"));
  };

  return { upgradeWebSocket, connections };
}
