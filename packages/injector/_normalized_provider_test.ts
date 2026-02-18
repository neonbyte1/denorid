import { assertEquals, assertThrows } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { Container } from "./container.ts";
import { InvalidProviderError } from "./errors.ts";
import type { Provider } from "./provider.ts";

describe("Provider normalization", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(() => {
    container.clear();
  });

  it("should handle factory provider with explicit mode", async () => {
    container.register({
      provide: "FACTORY",
      useFactory: () => "value",
      mode: "transient",
    });

    const a = await container.resolve("FACTORY");
    const b = await container.resolve("FACTORY");

    assertEquals(a, "value");
    assertEquals(b, "value");
  });

  it("should handle factory with async function", async () => {
    container.register({
      provide: "ASYNC_FACTORY",
      useFactory: async () => {
        await new Promise((r) => setTimeout(r, 1));
        return "async_value";
      },
    });

    const result = await container.resolve<string>("ASYNC_FACTORY");
    assertEquals(result, "async_value");
  });

  it("should throw InvalidProviderError for invalid provider", () => {
    assertThrows(
      () => container.register({ provide: "INVALID" } as Provider),
      InvalidProviderError,
    );
  });
});
