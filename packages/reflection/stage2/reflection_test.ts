import { assertEquals, assertNotEquals } from "@std/assert";
import { Reflection } from "./mod.ts";

function ExampleDecorator():
  & ClassDecorator
  & MethodDecorator
  & ParameterDecorator
  & PropertyDecorator {
  const fn = (): void => {};

  return fn as unknown as
    & ClassDecorator
    & MethodDecorator
    & ParameterDecorator
    & PropertyDecorator;
}

Deno.test(
  "getParamTypes() will return an empty array for undecorated classes",
  () => {
    class Stub {
      public constructor(public readonly name: string) {}
    }

    assertEquals(Reflection.getParamTypes(Stub).length, 0);
  },
);

Deno.test(
  "getParamTypes() will return an array of constructors",
  () => {
    @ExampleDecorator()
    class Stub {
      public constructor(public readonly name: string) {}
    }

    const params = Reflection.getParamTypes(Stub);

    assertEquals(params.length, 1);
    assertEquals(params[0], String);
  },
);

Deno.test(
  "getReturnType() will return undefined for undecorated classes",
  () => {
    class Stub {
      public example(): number {
        return 1337;
      }
    }

    assertEquals(Reflection.getReturnType(Stub, "example"), undefined);
  },
);

Deno.test(
  "getReturnType() will return the constructor of the return type, but using an instance as target",
  () => {
    class Stub {
      @ExampleDecorator()
      public example(): number {
        return 1337;
      }
    }

    const type = Reflection.getReturnType(new Stub(), "example");

    assertNotEquals(type, undefined);
    assertEquals(type, Number);
  },
);

Deno.test(
  "getPropType() will return undefined for undecorated classes",
  () => {
    class Stub {
      public date: Date = new Date();
    }

    assertEquals(Reflection.getPropType(Stub, "date"), undefined);
  },
);

Deno.test(
  "getPropType() will return undefined when the type is inferred from assignment",
  () => {
    class Stub {
      @ExampleDecorator()
      public date = new Date();
    }

    assertEquals(Reflection.getPropType(Stub, "date"), undefined);
  },
);

Deno.test(
  "getPropType() does return the constructor of the type behind it",
  () => {
    class Stub {
      @ExampleDecorator()
      public date!: Date;
    }

    assertEquals(Reflection.getPropType(Stub, "date"), Date);
  },
);
