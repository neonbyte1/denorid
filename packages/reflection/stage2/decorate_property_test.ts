import { assertEquals } from "@std/assert";
import type { Target } from "../common_types.ts";
import { decorateProperty } from "./decorate_property.ts";
import type { MemberDecorator } from "./types.ts";

Deno.test(
  "decorateProperty() does return undefined when no decorator is applied and no descriptor is given",
  () => {
    assertEquals(decorateProperty([], class Stub {}, "foo"), undefined);
  },
);

Deno.test(
  "decorateProperty() does return the input descriptor when no decorator is applied",
  () => {
    const descriptor: PropertyDescriptor = {
      configurable: true,
      enumerable: true,
      writable: true,
    };

    assertEquals(
      decorateProperty([], class Stub {}, "foo", descriptor),
      descriptor,
    );
  },
);

Deno.test(
  "decorateProperty() executes the decorators in reverse order",
  () => {
    const order: number[] = [];
    const decorators: MemberDecorator[] = [
      (_target: Target, _propertyKey: PropertyKey): void => {
        order.push(0);
      },
      (_target: Target, _propertyKey: PropertyKey): void => {
        order.push(1);
      },
    ];

    decorateProperty(decorators, class Stub {}, "foo");

    assertEquals(order[0], 1);
    assertEquals(order[1], 0);
  },
);

Deno.test(
  "decorateProperty() will return always the input descriptor if the decorator does not return anything",
  () => {
    const descriptors: Array<PropertyDescriptor | undefined> = [];
    const decorators: MemberDecorator[] = [
      <T>(
        _target: Target,
        _propertyKey: PropertyKey,
        descriptor?: TypedPropertyDescriptor<T>,
      ): void => {
        descriptors.push(descriptor);
      },

      <T>(
        _target: Target,
        _propertyKey: PropertyKey,
        descriptor?: TypedPropertyDescriptor<T>,
      ): void => {
        descriptors.push(descriptor);
      },
    ];

    decorateProperty(decorators, class Stub {}, "foo", {});

    assertEquals(descriptors[0], {});
    assertEquals(descriptors[1], {});
  },
);
