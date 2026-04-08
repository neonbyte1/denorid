import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { BadRequestException } from "../exceptions/http/bad_request.ts";
import { ParseBoolPipe } from "./parse_bool.ts";

describe("ParseBoolPipe", () => {
  describe("transform: truthy inputs", () => {
    it("accepts boolean true", () => {
      assertEquals(new ParseBoolPipe().transform(true), true);
    });

    it('accepts string "true"', () => {
      assertEquals(new ParseBoolPipe().transform("true"), true);
    });
  });

  describe("transform: falsy inputs", () => {
    it("accepts boolean false", () => {
      assertEquals(new ParseBoolPipe().transform(false), false);
    });

    it('accepts string "false"', () => {
      assertEquals(new ParseBoolPipe().transform("false"), false);
    });
  });

  describe("transform: optional nil handling", () => {
    it("returns null when optional and value is null", () => {
      const pipe = new ParseBoolPipe({ optional: true });

      assertEquals(pipe.transform(null!), null);
    });

    it("returns undefined when optional and value is undefined", () => {
      const pipe = new ParseBoolPipe({ optional: true });

      assertEquals(pipe.transform(undefined!), undefined);
    });
  });

  describe("transform: invalid values", () => {
    it("throws BadRequestException for an arbitrary string", () => {
      const pipe = new ParseBoolPipe();

      assertThrows(
        () => pipe.transform("yes"),
        BadRequestException,
      );
    });

    it('throws BadRequestException for string "1"', () => {
      const pipe = new ParseBoolPipe();

      assertThrows(
        () => pipe.transform("1"),
        BadRequestException,
      );
    });

    it("calls exceptionFactory with the validation message", () => {
      const factory = spy((_msg: string) => new Error("custom"));
      const pipe = new ParseBoolPipe({ exceptionFactory: factory });

      assertThrows(() => pipe.transform("invalid"));
      assertSpyCalls(factory, 1);
    });

    it("throws when null and not optional", () => {
      const pipe = new ParseBoolPipe();

      assertThrows(() => pipe.transform(null!), BadRequestException);
    });

    it("throws when undefined and not optional", () => {
      const pipe = new ParseBoolPipe();

      assertThrows(
        () => pipe.transform(undefined!),
        BadRequestException,
      );
    });
  });

  describe("custom exceptionFactory", () => {
    it("uses the provided factory on failure", () => {
      const err = new RangeError("custom");
      const pipe = new ParseBoolPipe({ exceptionFactory: () => err });

      let caught: unknown;

      try {
        pipe.transform("bad");
      } catch (e) {
        caught = e;
      }

      assertInstanceOf(caught, RangeError);
    });
  });
});
