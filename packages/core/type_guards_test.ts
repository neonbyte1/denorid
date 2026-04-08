import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { isFunction, isNil, isString } from "./type_guards.ts";

describe("isNil", () => {
  it("returns true for null", () => {
    assertEquals(isNil(null), true);
  });

  it("returns true for undefined", () => {
    assertEquals(isNil(undefined), true);
  });

  it("returns false for empty string", () => {
    assertEquals(isNil(""), false);
  });

  it("returns false for 0", () => {
    assertEquals(isNil(0), false);
  });

  it("returns false for false", () => {
    assertEquals(isNil(false), false);
  });

  it("returns false for a non-nil value", () => {
    assertEquals(isNil("hello"), false);
  });
});

describe("isString", () => {
  it("returns true for a non-empty string", () => {
    assertEquals(isString("hello"), true);
  });

  it("returns true for an empty string", () => {
    assertEquals(isString(""), true);
  });

  it("returns false for a number", () => {
    assertEquals(isString(42), false);
  });

  it("returns false for null", () => {
    assertEquals(isString(null), false);
  });

  it("returns false for undefined", () => {
    assertEquals(isString(undefined), false);
  });

  it("returns false for an object", () => {
    assertEquals(isString({}), false);
  });

  it("returns false for a boolean", () => {
    assertEquals(isString(true), false);
  });
});

describe("isFunction", () => {
  it("returns true for an arrow function", () => {
    assertEquals(isFunction(() => {}), true);
  });

  it("returns true for a named function declaration", () => {
    function foo() {}
    assertEquals(isFunction(foo), true);
  });

  it("returns true for a class constructor", () => {
    class MyClass {}
    assertEquals(isFunction(MyClass), true);
  });

  it("returns false for a string", () => {
    assertEquals(isFunction("foo"), false);
  });

  it("returns false for null", () => {
    assertEquals(isFunction(null), false);
  });

  it("returns false for an object", () => {
    assertEquals(isFunction({}), false);
  });

  it("returns false for a number", () => {
    assertEquals(isFunction(42), false);
  });
});
