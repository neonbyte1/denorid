import { assertEquals } from "@std/assert";
import { describe, it } from "node:test";
import { STATUS_TEXT, StatusCode } from "./status.ts";

describe("STATUS_TEXT", () => {
  it("has a reason phrase for every StatusCode member", () => {
    const missing = Object.values(StatusCode)
      .filter((code): code is number => typeof code === "number")
      .filter((code) => !(STATUS_TEXT as Record<number, string>)[code]);

    assertEquals(missing, []);
  });

  it("labels 303 as See Other", () => {
    assertEquals(STATUS_TEXT[StatusCode.SeeOther], "See Other");
  });

  it("labels the informal proxy timeout codes 598 and 599", () => {
    assertEquals(
      STATUS_TEXT[StatusCode.NetworkReadTimeoutError],
      "Network Read Timeout Error",
    );
    assertEquals(
      STATUS_TEXT[StatusCode.NetworkConnectTimeoutError],
      "Network Connect Timeout Error",
    );
  });
});
