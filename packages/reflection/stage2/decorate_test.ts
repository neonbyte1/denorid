import { assertEquals, assertThrows } from "@std/assert";
import {
  type Constructor,
  EmptyArrayArgumentError,
  InvalidArgumentError,
  type Target,
} from "../common_types.ts";
import { Reflection } from "./reflection.ts";
import type { GenericClassDecorator, MemberDecorator } from "./types.ts";

Deno.test(
  "decorate() throws InvalidArgumentError when the target is undefined or null",
  () => {
    assertThrows(
      () => Reflection.decorate([], undefined as unknown as Constructor),
      InvalidArgumentError,
    );
    assertThrows(
      () => Reflection.decorate([], null as unknown as Constructor),
      InvalidArgumentError,
    );
  },
);

Deno.test(
  "decorate() throws InvalidArgumentError when the decorators parameter is not an array",
  () => {
    assertThrows(
      () =>
        Reflection.decorate(
          undefined as unknown as GenericClassDecorator[],
          class Stub {},
        ),
      InvalidArgumentError,
    );
  },
);

Deno.test(
  "decorate() throws EmptyArrayArgumentError when the decorators parameter is an empty array",
  () => {
    assertThrows(
      () => Reflection.decorate([], class Stub {}),
      EmptyArrayArgumentError,
    );
  },
);

Deno.test(
  "decorate() returns undefined with invalid target and undefined property and descriptor",
  () => {
    const cache: unknown[] = [];
    const decorators: MemberDecorator[] = [
      <T>(
        target: Target,
        _propertyKey: PropertyKey,
        _descriptor?: TypedPropertyDescriptor<T>,
      ): void => {
        cache.push(target);
      },
    ];

    assertEquals(cache, []);
    assertEquals(
      Reflection.decorate(decorators, {}, undefined, undefined),
      undefined,
    );
  },
);

Deno.test(
  "decorate() executed decorators in reverse order for function",
  () => {
    const order: number[] = [];
    const decorators = [
      <T>(target: Constructor<T>): Constructor<T> => {
        order.push(0);

        return target;
      },
      (): void => {
        order.push(1);
      },
    ];

    Reflection.decorate(decorators, class Stub {});

    assertEquals(order.length, decorators.length);
    assertEquals(order[0], 1);
    assertEquals(order[1], 0);
  },
);

Deno.test(
  "decorate() executed decorators in reverse order for proeprty",
  () => {
    const order: number[] = [];
    const decorators = [
      (): void => {
        order.push(0);
      },
      (): void => {
        order.push(1);
      },
    ];

    Reflection.decorate(decorators, class Stub {}, "example-property");

    assertEquals(order.length, decorators.length);
    assertEquals(order[0], 1);
    assertEquals(order[1], 0);
  },
);

Deno.test(
  "decorate() executed decorators in reverse order for proeprty and descriptor",
  () => {
    const order: number[] = [];
    const decorators = [
      (): void => {
        order.push(0);
      },
      (): void => {
        order.push(1);
      },
    ];

    Reflection.decorate(decorators, class Stub {}, "example-property", {});

    assertEquals(order.length, decorators.length);
    assertEquals(order[0], 1);
    assertEquals(order[1], 0);
  },
);
