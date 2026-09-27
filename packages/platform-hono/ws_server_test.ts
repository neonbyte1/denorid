import { assertEquals } from "@std/assert";
import { describe, it } from "node:test";
import { createFakeSocket, type FakeSocket } from "./_test_utils.ts";
import { WsClient } from "./ws_client.ts";
import { WsServer } from "./ws_server.ts";

describe(WsServer.name, () => {
  function createClient(...rooms: string[]): [WsClient, FakeSocket] {
    const socket = createFakeSocket();
    const client = new WsClient(
      socket.context,
      new Request("http://localhost/chat"),
    );

    rooms.forEach((room) => client.join(room));

    return [client, socket];
  }

  it("exposes path and clients", () => {
    const [client] = createClient();
    const clients = new Set([client]);
    const server = new WsServer("/chat", clients);

    assertEquals(server.path, "/chat");
    assertEquals(server.clients, clients);
  });

  describe("emit()", () => {
    it("sends the event to every open client", () => {
      const [first, firstSocket] = createClient();
      const [second, secondSocket] = createClient();
      const [closed, closedSocket] = createClient();

      closedSocket.raw.readyState = 3;

      new WsServer("/", new Set([first, second, closed])).emit("news", 1);

      assertEquals(firstSocket.sent, ['{"event":"news","data":1}']);
      assertEquals(secondSocket.sent, ['{"event":"news","data":1}']);
      assertEquals(closedSocket.sent, []);
    });
  });

  describe("to()", () => {
    it("sends the event to the clients of a room", () => {
      const [member, memberSocket] = createClient("lobby");
      const [other, otherSocket] = createClient("games");
      const server = new WsServer("/", new Set([member, other]));

      server.to("lobby").emit("hello");

      assertEquals(memberSocket.sent, ['{"event":"hello"}']);
      assertEquals(otherSocket.sent, []);
    });

    it("sends the event once to clients of several rooms", () => {
      const [both, bothSocket] = createClient("lobby", "games");
      const [games, gamesSocket] = createClient("games");
      const [none, noneSocket] = createClient();
      const server = new WsServer("/", new Set([both, games, none]));

      server.to(["lobby", "games"]).emit("hello", { n: 1 });

      assertEquals(bothSocket.sent, ['{"event":"hello","data":{"n":1}}']);
      assertEquals(gamesSocket.sent, ['{"event":"hello","data":{"n":1}}']);
      assertEquals(noneSocket.sent, []);
    });

    it("selects the members at the time of emitting", () => {
      const [client, socket] = createClient();
      const server = new WsServer("/", new Set([client]));
      const lobby = server.to("lobby");

      client.join("lobby");
      lobby.emit("hello");

      assertEquals(socket.sent, ['{"event":"hello"}']);
    });
  });
});
