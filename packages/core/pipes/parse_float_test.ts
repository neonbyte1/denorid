import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { BadRequestException } from "../exceptions/http/bad_request.ts";
import { ParseFloatPipe } from "./parse_float.ts";

describe("ParseFloatPipe", () => {
  describe("transform: valid numeric strings", () => {
    it("parses a positive float string", () => {
      assertEquals(new ParseFloatPipe().transform("3.14"), 3.14);
    });

    it("parses a negative float string", () => {
      assertEquals(new ParseFloatPipe().transform("-1.5"), -1.5);
    });

    it("parses an integer string", () => {
      assertEquals(new ParseFloatPipe().transform("42"), 42);
    });

    it("parses zero as string", () => {
      assertEquals(new ParseFloatPipe().transform("0.0"), 0);
    });
  });

  describe("transform: numeric values", () => {
    it("passes through a finite number", () => {
      assertEquals(new ParseFloatPipe().transform(99.9), 99.9);
    });

    it("passes through 0", () => {
      assertEquals(new ParseFloatPipe().transform(0), 0);
    });
  });

  describe("transform: optional nil handling", () => {
    it("returns null when optional and value is null", () => {
      const pipe = new ParseFloatPipe({ optional: true });
      assertEquals(pipe.transform(null), null);
    });

    it("returns undefined when optional and value is undefined", () => {
      const pipe = new ParseFloatPipe({ optional: true });
      assertEquals(pipe.transform(undefined), undefined);
    });
  });

  describe("transform: invalid inputs", () => {
    it("throws BadRequestException for a non-numeric string", () => {
      assertThrows(
        () => new ParseFloatPipe().transform("abc"),
        BadRequestException,
      );
    });

    it("throws BadRequestException for NaN", () => {
      assertThrows(
        () => new ParseFloatPipe().transform(NaN),
        BadRequestException,
      );
    });

    it("throws BadRequestException for Infinity", () => {
      assertThrows(
        () => new ParseFloatPipe().transform(Infinity),
        BadRequestException,
      );
    });

    it("throws BadRequestException for -Infinity", () => {
      assertThrows(
        () => new ParseFloatPipe().transform(-Infinity),
        BadRequestException,
      );
    });

    it("throws BadRequestException for null when not optional", () => {
      assertThrows(
        () => new ParseFloatPipe().transform(null),
        BadRequestException,
      );
    });

    it("throws BadRequestException for undefined when not optional", () => {
      assertThrows(
        () => new ParseFloatPipe().transform(undefined),
        BadRequestException,
      );
    });

    it("calls exceptionFactory with the validation message", () => {
      const factory = spy((_msg: string) => new Error("custom"));
      const pipe = new ParseFloatPipe({ exceptionFactory: factory });

      assertThrows(() => pipe.transform("bad"));
      assertSpyCalls(factory, 1);
    });
  });
});
