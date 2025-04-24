import { assertEquals } from "@std/assert";
import type { Constructor } from "../common_types.ts";
import { decorateConstructor } from "./decorate_constructor.ts";

Deno.test("decorateConstructor() does always return the input constructor", () => {
  class Stub {}

  assertEquals(decorateConstructor([], Stub), Stub);
  assertEquals(decorateConstructor([<T>(_: Constructor<T>) => {}], Stub), Stub);
  assertEquals(
    decorateConstructor([<T>(target: Constructor<T>) => target], Stub),
    Stub,
  );
});
