import { WSContext } from "@hono/hono/ws";
import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { describe, it } from "node:test";
import { createFakeSocket } from "./_test_utils.ts";
import { WsClient } from "./ws_client.ts";

describe(WsClient.name, () => {
  const request = new Request("http://localhost/chat");

  it("has a unique id and keeps the upgrade request", () => {
    const first = new WsClient(createFakeSocket().context, request);
    const second = new WsClient(createFakeSocket().context, request);

    assertMatch(first.id, /^[0-9a-f-]{36}$/);
    assertNotEquals(first.id, second.id);
    assertEquals(first.request, request);
  });

  describe("readyState", () => {
    it("follows the raw socket", () => {
      const socket = createFakeSocket();
      const client = new WsClient(socket.context, request);

      assertEquals(client.readyState, 1);

      socket.raw.readyState = 2;

      assertEquals(client.readyState, 2);
    });

    it("falls back to the context without a raw socket state", () => {
      const withoutRaw = new WSContext({
        readyState: 0,
        send: () => {},
        close: () => {},
      });
      const withoutState = new WSContext({
        raw: {},
        readyState: 3,
        send: () => {},
        close: () => {},
      });

      assertEquals(new WsClient(withoutRaw, request).readyState, 0);
      assertEquals(new WsClient(withoutState, request).readyState, 3);
    });
  });

  describe("send()", () => {
    it("sends raw data while open", () => {
      const socket = createFakeSocket();
      const client = new WsClient(socket.context, request);
      const bytes = new Uint8Array([1, 2]);

      client.send("text");
      client.send(bytes);

      assertEquals(socket.sent, ["text", bytes]);
    });

    it("does nothing unless open", () => {
      for (const readyState of [0, 2, 3] as const) {
        const socket = createFakeSocket(readyState);

        new WsClient(socket.context, request).send("text");

        assertEquals(socket.sent, []);
      }
    });
  });

  describe("emit()", () => {
    it("sends an event frame", () => {
      const socket = createFakeSocket();
      const client = new WsClient(socket.context, request);

      client.emit("chat", { text: "hi" });
      client.emit("ping");

      assertEquals(socket.sent, [
        '{"event":"chat","data":{"text":"hi"}}',
        '{"event":"ping"}',
      ]);
    });
  });

  describe("rooms", () => {
    it("tracks joined rooms until left", () => {
      const client = new WsClient(createFakeSocket().context, request);

      client.join("lobby");
      client.join("games");
      client.join("lobby");
      client.leave("games");
      client.leave("unknown");

      assertEquals([...client.rooms], ["lobby"]);
    });
  });

  describe("close()", () => {
    it("closes the socket with code and reason", () => {
      const socket = createFakeSocket();
      const client = new WsClient(socket.context, request);

      client.close(4000, "bye");
      client.close();

      assertEquals(socket.closes, [[4000, "bye"], [undefined, undefined]]);
      assertEquals(client.readyState, 3);
    });
  });
});
