import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  isBaseProvider,
  isClassProvider,
  isExistingProvider,
  isFactoryProvider,
  isValueProvider,
} from "./_internal.ts";
import { SimpleService } from "./_test_fixtures.ts";

describe("Providers", () => {
  describe("should handle isBaseProvider with excludeBaseCheck", () => {
    it("trying isBaseProvider", () => {
      const result1 = isBaseProvider({ foo: "bar" }, {
        excludeBaseCheck: true,
      });
      const result2 = isBaseProvider({ foo: "bar" });

      assertEquals(result1, true);
      assertEquals(result2, false);
    });

    it("trying isClassProvider()", () => {
    });

    it("trying isClassProvider()", () => {
      assertEquals(
        isClassProvider({ useClass: SimpleService }, {
          excludeBaseCheck: true,
        }),
        true,
      );
    });

    it("trying isFactoryProvider()", () => {
      assertEquals(
        isFactoryProvider({ useFactory: () => {} }, { excludeBaseCheck: true }),
        true,
      );
    });

    it("trying isValueProvider()", () => {
      assertEquals(
        isValueProvider({ useValue: 42 }, { excludeBaseCheck: true }),
        true,
      );
    });

    it("trying isExistingProvider()", () => {
      assertEquals(
        isExistingProvider({ useExisting: SimpleService }, {
          excludeBaseCheck: true,
        }),
        true,
      );
    });
  });
});
