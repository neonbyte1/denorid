import { WsException } from "@denorid/core";
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import {
  eventFrame,
  exceptionFrame,
  parseMessage,
  resultFrame,
} from "./_ws_protocol.ts";

describe(parseMessage.name, () => {
  it("parses event, data and id", () => {
    assertEquals(
      parseMessage('{"event":"chat","data":{"text":"hi"},"id":7}'),
      { event: "chat", data: { text: "hi" }, id: 7 },
    );
    assertEquals(parseMessage('{"event":"chat","id":"a"}'), {
      event: "chat",
      data: undefined,
      id: "a",
    });
  });

  it("drops ids that are neither strings nor numbers", () => {
    assertEquals(parseMessage('{"event":"chat","data":1,"id":{}}'), {
      event: "chat",
      data: 1,
    });
  });

  it("ignores binary frames, invalid JSON, non-objects and non-string events", () => {
    for (
      const data of [
        new ArrayBuffer(2),
        "{",
        "null",
        "42",
        '"chat"',
        "[]",
        '{"data":1}',
        '{"event":1}',
      ]
    ) {
      assertEquals(parseMessage(data), undefined);
    }
  });
});

describe(eventFrame.name, () => {
  it("serializes event and data", () => {
    assertEquals(
      eventFrame("chat", { text: "hi" }),
      '{"event":"chat","data":{"text":"hi"}}',
    );
  });

  it("omits undefined data", () => {
    assertEquals(eventFrame("ping", undefined), '{"event":"ping"}');
  });
});

describe(resultFrame.name, () => {
  it("sends nothing for undefined", () => {
    assertEquals(resultFrame(undefined, 1), undefined);
  });

  it("sends WsResponse results as events, without the id", () => {
    assertEquals(
      resultFrame({ event: "pong", data: [1] }, 1),
      '{"event":"pong","data":[1]}',
    );
  });

  it("replies with id and data when the message had an id", () => {
    assertEquals(resultFrame("ok", "a"), '{"id":"a","data":"ok"}');
    assertEquals(resultFrame(null, 0), '{"id":0,"data":null}');
  });

  it("replies with the result as is without an id", () => {
    assertEquals(resultFrame({ ok: true }), '{"ok":true}');
    assertEquals(resultFrame("ok"), '"ok"');
  });

  it("throws for results that cannot be serialized", () => {
    assertThrows(() => resultFrame(1n), TypeError);
  });
});

describe(exceptionFrame.name, () => {
  it("sends the payload of a WsException", () => {
    assertEquals(
      exceptionFrame(new WsException("Room is full")),
      '{"event":"exception","data":{"status":"error","message":"Room is full"}}',
    );
    assertEquals(
      exceptionFrame(new WsException({ code: "FULL" }), 3),
      '{"event":"exception","data":{"code":"FULL"},"id":3}',
    );
  });

  it("sends a generic payload for other errors", () => {
    assertEquals(
      exceptionFrame(new Error("secret"), "a"),
      '{"event":"exception","data":{"status":"error","message":"Internal server error"},"id":"a"}',
    );
  });

  it("sends a generic payload when the WsException payload cannot be serialized", () => {
    const payload: Record<string, unknown> = {};
    const exception = new WsException(payload);

    payload.big = 1n;

    assertEquals(
      exceptionFrame(exception),
      '{"event":"exception","data":{"status":"error","message":"Internal server error"}}',
    );
  });
});
