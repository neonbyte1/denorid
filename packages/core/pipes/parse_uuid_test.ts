import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { BadRequestException } from "../exceptions/http/bad_request.ts";
import { ParseUuidPipe } from "./parse_uuid.ts";

describe("ParseUuidPipe", () => {
  const UUID_V1 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  const UUID_V4 = "550e8400-e29b-41d4-a716-446655440000";
  const UUID_V7 = "018c4437-3c42-7c0a-b3d6-7c88b0e00e9e";

  describe("transform: any valid UUID (no version constraint)", () => {
    it("accepts a valid v1 UUID", () => {
      assertEquals(new ParseUuidPipe().transform(UUID_V1), UUID_V1);
    });

    it("accepts a valid v4 UUID", () => {
      assertEquals(new ParseUuidPipe().transform(UUID_V4), UUID_V4);
    });

    it("accepts a valid v7 UUID", () => {
      assertEquals(new ParseUuidPipe().transform(UUID_V7), UUID_V7);
    });
  });

  describe("transform: version-constrained", () => {
    it("accepts a v4 UUID when version=4", () => {
      const pipe = new ParseUuidPipe({ version: 4 });

      assertEquals(pipe.transform(UUID_V4), UUID_V4);
    });

    it("accepts a v4 UUID when version='4' (string)", () => {
      const pipe = new ParseUuidPipe({ version: "4" });

      assertEquals(pipe.transform(UUID_V4), UUID_V4);
    });

    it("accepts a v1 UUID when version=1", () => {
      const pipe = new ParseUuidPipe({ version: 1 });

      assertEquals(pipe.transform(UUID_V1), UUID_V1);
    });

    it("rejects a v4 UUID when version=1", () => {
      const pipe = new ParseUuidPipe({ version: 1 });

      assertThrows(() => pipe.transform(UUID_V4), BadRequestException);
    });

    it("error message includes the version number", () => {
      const pipe = new ParseUuidPipe({ version: 4 });

      let message = "";

      try {
        pipe.transform("not-a-uuid");
      } catch (e) {
        message = (e as Error).message;
      }

      assertEquals(message.includes("v4"), true);
    });
  });

  describe("transform:  optional nil handling", () => {
    it("returns null when optional and value is null", () => {
      const pipe = new ParseUuidPipe({ optional: true });

      assertEquals(pipe.transform(null), null);
    });

    it("returns undefined when optional and value is undefined", () => {
      const pipe = new ParseUuidPipe({ optional: true });

      assertEquals(pipe.transform(undefined), undefined);
    });
  });

  describe("transform:  invalid inputs", () => {
    it("throws BadRequestException for a plain string", () => {
      assertThrows(
        () => new ParseUuidPipe().transform("not-a-uuid"),
        BadRequestException,
      );
    });

    it("throws BadRequestException for null when not optional", () => {
      assertThrows(
        () => new ParseUuidPipe().transform(null),
        BadRequestException,
      );
    });

    it("throws BadRequestException for undefined when not optional", () => {
      assertThrows(
        () => new ParseUuidPipe().transform(undefined),
        BadRequestException,
      );
    });

    it("error message omits version when none is specified", () => {
      let message = "";

      try {
        new ParseUuidPipe().transform("bad");
      } catch (e) {
        message = (e as Error).message;
      }

      assertEquals(message.includes(" v"), false);
    });

    it("calls exceptionFactory with the validation message", () => {
      const factory = spy((_msg: string) => new Error("custom"));
      const pipe = new ParseUuidPipe({ exceptionFactory: factory });

      assertThrows(() => pipe.transform("bad"));
      assertSpyCalls(factory, 1);
    });
  });
});
