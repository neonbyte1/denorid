import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { isPlainObject } from "./_internal.ts";

describe("isPlainObject", () => {
  it("should return false for non-objects", () => {
    assertEquals(isPlainObject("string"), false);
    assertEquals(isPlainObject(123), false);
    assertEquals(isPlainObject(null), false);
    assertEquals(isPlainObject(undefined), false);
    assertEquals(isPlainObject(true), false);
    assertEquals(isPlainObject(Symbol("test")), false);
  });

  it("should return true for plain objects", () => {
    assertEquals(isPlainObject({}), true);
    assertEquals(isPlainObject({ a: 1 }), true);
  });

  it("should return true for Object.create(null)", () => {
    assertEquals(isPlainObject(Object.create(null)), true);
  });

  it("should return false for class instances", () => {
    class MyClass {}
    assertEquals(isPlainObject(new MyClass()), false);
  });

  it("should return false for arrays", () => {
    assertEquals(isPlainObject([]), false);
    assertEquals(isPlainObject([1, 2, 3]), false);
  });

  it("should return false for Date objects", () => {
    assertEquals(isPlainObject(new Date()), false);
  });

  it("should return false for Map and Set", () => {
    assertEquals(isPlainObject(new Map()), false);
    assertEquals(isPlainObject(new Set()), false);
  });
});
