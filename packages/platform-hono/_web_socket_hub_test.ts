import { upgradeWebSocket as upgradeDenoWebSocket } from "@hono/hono/deno";
import type { WSEvents } from "@hono/hono/ws";
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { assertSpyCalls, type Spy, spy } from "@std/testing/mock";
import { describe, it } from "node:test";
import { createFakeUpgrade } from "./_test_utils.ts";
import { getWebSocketHub, WebSocketHub } from "./_web_socket_hub.ts";

describe(WebSocketHub.name, () => {
  function upgradeRequest(
    path: string,
    init: RequestInit = { headers: { upgrade: "websocket" } },
  ): Request {
    return new Request(`http://localhost${path}`, init);
  }

  function createHub(): {
    hub: WebSocketHub;
    fallback: Spy<unknown, [Request, object], Response>;
  } {
    const fallback = spy((_request: Request, _env: object) =>
      new Response("app")
    );

    return { hub: new WebSocketHub({}, fallback), fallback };
  }

  const events: WSEvents = { onOpen: () => {} };

  it("is registered for its owner", () => {
    const owner = {};
    const hub = new WebSocketHub(owner, () => new Response());

    assertStrictEquals(getWebSocketHub(owner), hub);
    assertEquals(getWebSocketHub({}), undefined);
  });

  describe("fetch()", () => {
    it("passes every request to the fallback until listening with a helper", async () => {
      const { hub, fallback } = createHub();
      const env = {};

      await hub.register("/chat", () => events);

      assertEquals(
        await (await hub.fetch(upgradeRequest("/chat"), env)).text(),
        "app",
      );

      hub.listen();

      assertEquals(
        await (await hub.fetch(upgradeRequest("/chat"), env)).text(),
        "app",
      );
      assertSpyCalls(fallback, 2);
      assertStrictEquals(fallback.calls[1].args[1], env);
    });

    it("upgrades requests on registered paths", async () => {
      const { hub, fallback } = createHub();
      const upgrade = createFakeUpgrade();
      const requests: Request[] = [];

      await hub.register("/chat", (request) => {
        requests.push(request);

        return events;
      });
      hub.listen(upgrade.upgradeWebSocket);

      const request = upgradeRequest("/chat?room=1", {
        headers: { upgrade: "websocket", cookie: "session=1" },
      });
      const response = await hub.fetch(request, {});

      assertEquals(await response.text(), "upgraded");
      assertEquals(upgrade.connections, [events]);
      assertEquals(requests[0].url, "http://localhost/chat?room=1");
      assertEquals(requests[0].headers.get("cookie"), "session=1");
      assertSpyCalls(fallback, 0);
    });

    it("passes other requests on to the fallback", async () => {
      const { hub, fallback } = createHub();
      const upgrade = createFakeUpgrade();
      const env = { bindings: true };

      await hub.register("/chat", () => events);
      hub.listen(upgrade.upgradeWebSocket);

      for (
        const request of [
          upgradeRequest("/chat", {}),
          upgradeRequest("/other"),
          upgradeRequest("/chat", { headers: { upgrade: "h2c" } }),
          upgradeRequest("/chat", {
            method: "POST",
            headers: { upgrade: "websocket" },
          }),
        ]
      ) {
        assertEquals(await (await hub.fetch(request, env)).text(), "app");
      }

      assertEquals(upgrade.connections, []);
      assertSpyCalls(fallback, 4);
      assertStrictEquals(fallback.calls[1].args[1], env);
      assertEquals(fallback.calls[1].args[0].url, "http://localhost/other");
    });

    it("stops upgrading once stopped or unregistered", async () => {
      const { hub } = createHub();
      const upgrade = createFakeUpgrade();

      await hub.register("/chat", () => events);
      await hub.register("/news", () => events);
      hub.listen(upgrade.upgradeWebSocket);
      hub.unregister("/news");

      assertEquals(
        await (await hub.fetch(upgradeRequest("/news"), {})).text(),
        "app",
      );

      hub.stop();

      assertEquals(
        await (await hub.fetch(upgradeRequest("/chat"), {})).text(),
        "app",
      );
      assertEquals(upgrade.connections, []);
    });
  });

  describe("register()", () => {
    it("loads the modules of the runtime once a path is registered", async () => {
      const { hub } = createHub();

      assertEquals(hub.modules, undefined);

      await hub.register("/chat", () => events);

      assertEquals(hub.modules, { deno: upgradeDenoWebSocket });

      hub.unregister("/chat");

      assertEquals(hub.modules, undefined);
    });

    it("loads the modules of the injected runtime", async () => {
      const hub = new WebSocketHub({}, () => new Response(), {});

      await hub.register("/chat", () => events);

      assertEquals(hub.modules, {});
    });

    it("rejects taken paths", async () => {
      const { hub } = createHub();

      await hub.register("/chat", () => events);

      await assertRejects(
        () => hub.register("/chat", () => events),
        Error,
        'WebSocket path "/chat" is already in use',
      );
    });

    it("rejects while listening", async () => {
      const { hub } = createHub();

      hub.listen();

      await assertRejects(
        () => hub.register("/chat", () => events),
        Error,
        "WebSocket gateways must be created before the HonoAdapter listens",
      );

      hub.stop();
      await hub.register("/chat", () => events);
    });
  });
});
