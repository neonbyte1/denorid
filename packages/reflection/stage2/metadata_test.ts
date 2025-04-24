import { assertEquals, assertThrows } from "@std/assert";
import { InvalidArgumentError, type Target } from "../common_types.ts";
import { Reflection } from "./reflection.ts";

Deno.test(
  "ordinaryDefineOwnMetadata() throws InvalidArgumentError when the target is undefined or null",
  () => {
    const undefinedTarget = undefined as unknown as Target;
    const nulledTarget = null as unknown as Target;

    assertThrows(
      () =>
        Reflection.defineMetadata(
          "name",
          "denorid",
          undefinedTarget,
        ),
      InvalidArgumentError,
    );
    assertThrows(
      () =>
        Reflection.defineMetadata(
          "name",
          "denorid",
          nulledTarget,
        ),
      InvalidArgumentError,
    );

    assertThrows(
      () => Reflection.metadata("name", "denorid")(undefinedTarget),
      InvalidArgumentError,
    );
    assertThrows(
      () => Reflection.metadata("name", "denorid")(nulledTarget),
      InvalidArgumentError,
    );
  },
);

Deno.test(
  "ordinaryGetOwnMetadata() throws InvalidArgumentError when the target is undefined or null",
  () => {
    const undefinedTarget = undefined as unknown as Target;
    const nulledTarget = null as unknown as Target;

    assertThrows(
      () => Reflection.getOwnMetadata("name", undefinedTarget),
      InvalidArgumentError,
    );
    assertThrows(
      () => Reflection.getOwnMetadata("name", nulledTarget),
      InvalidArgumentError,
    );

    assertThrows(
      () => Reflection.hasOwnMetadata("name", undefinedTarget),
      InvalidArgumentError,
    );
    assertThrows(
      () => Reflection.hasOwnMetadata("name", nulledTarget),
      InvalidArgumentError,
    );
  },
);

Deno.test(
  "ordinaryDefineOwnMetadata() throws InvalidArgumentError when the propertyKey type is not a string, number or symbol",
  () => {
    assertThrows(
      () =>
        Reflection.defineMetadata(
          "name",
          "denorid",
          class Stub {},
          {} as unknown as PropertyKey,
        ),
      InvalidArgumentError,
    );
    assertThrows(
      () =>
        Reflection.metadata("name", "denorid")(
          class Stub {},
          {} as unknown as PropertyKey,
        ),
      InvalidArgumentError,
    );
  },
);

Deno.test(
  "hasMetadata() returns false if the key is not defined",
  () => {
    assertEquals(Reflection.hasMetadata("key", class Stub {}), false);
    assertEquals(Reflection.hasMetadata("key", class Stub {}, "deno"), false);
  },
);

Deno.test(
  "hasMetadata() returns true if the key was defined",
  () => {
    class Stub {}

    Reflection.defineMetadata("key1", Date.now(), Stub);
    assertEquals(Reflection.hasMetadata("key1", Stub), true);

    Reflection.defineMetadata("key2", Date.now(), Stub, "foo");
    assertEquals(Reflection.hasMetadata("key2", Stub, "foo"), true);
  },
);

Deno.test(
  "getMetadata() returns undefined for unknown metadata keys",
  () => {
    assertEquals(Reflection.getMetadata("author", class Stub {}), undefined);
  },
);

Deno.test(
  "getMetadata() returns expected data",
  () => {
    class Stub {}

    Reflection.defineMetadata("author", "denorid", Stub);
    Reflection.defineMetadata("registry", "jsr", Stub);

    assertEquals(Reflection.getMetadata("author", Stub), "denorid");
    assertEquals(
      Reflection.getMetadata("registry", Stub),
      "jsr",
    );
  },
);
