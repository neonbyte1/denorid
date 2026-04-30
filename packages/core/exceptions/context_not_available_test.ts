import { assertEquals, assertInstanceOf, assertMatch } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { ContextNotAvailableException } from "./context_not_available.ts";

describe("ContextNotAvailableException", () => {
  it("is an instance of Error", () => {
    assertInstanceOf(
      new ContextNotAvailableException(
        "microservice",
        "switchToHttp",
        "switchToRpc",
      ),
      Error,
    );
  });

  it("formats the message with context, forbidden, and expected method names", () => {
    const err = new ContextNotAvailableException(
      "microservice",
      "switchToHttp",
      "switchToRpc",
    );
    assertMatch(err.message, /switchToHttp\(\)/);
    assertMatch(err.message, /microservice context/);
    assertMatch(err.message, /switchToRpc\(\)/);
  });

  it("omits the expected method hint when none is provided", () => {
    const err = new ContextNotAvailableException(
      "http",
      "switchToRpc",
      undefined,
    );

    assertEquals(
      err.message,
      "switchToRpc() is not available in http context.",
    );
  });
});
