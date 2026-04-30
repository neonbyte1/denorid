import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  ConnectionNotEstablishedException,
  ConnectionNotFoundException,
} from "./exceptions.ts";

describe("KV exceptions", () => {
  it("formats missing connection errors", () => {
    const error = new ConnectionNotFoundException("primary");

    assertInstanceOf(error, Error);
    assertEquals(error.message, 'Failed to find "primary" connection.');
  });

  it("formats not-established connection errors", () => {
    const error = new ConnectionNotEstablishedException("primary");

    assertInstanceOf(error, Error);
    assertEquals(
      error.message,
      'The connection to "primary" kv is not established yet.',
    );
  });
});
