import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "node:test";
import { IntrinsicException } from "../exceptions/intrinsic.ts";
import { WsException } from "./exception.ts";

describe(WsException.name, () => {
  it("wraps string errors in an error payload", () => {
    const exception = new WsException("Room is full");

    assertInstanceOf(exception, IntrinsicException);
    assertEquals(exception.name, "WsException");
    assertEquals(exception.message, "Room is full");
    assertEquals(exception.getError(), "Room is full");
    assertEquals(exception.getPayload(), {
      status: "error",
      message: "Room is full",
    });
  });

  it("sends object errors as they are", () => {
    const error = { code: "ROOM_FULL", room: "lobby" };
    const exception = new WsException(error);

    assertEquals(exception.message, JSON.stringify(error));
    assertEquals(exception.getError(), error);
    assertEquals(exception.getPayload(), error);
  });
});
