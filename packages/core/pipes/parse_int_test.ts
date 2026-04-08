import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { BadRequestException } from "../exceptions/http/bad_request.ts";
import { ParseIntPipe } from "./parse_int.ts";

describe("ParseIntPipe", () => {
  describe("transform: valid integer strings", () => {
    it("parses a positive integer string", () => {
      assertEquals(new ParseIntPipe().transform("42"), 42);
    });

    it("parses a negative integer string", () => {
      assertEquals(new ParseIntPipe().transform("-7"), -7);
    });

    it("parses zero as string", () => {
      assertEquals(new ParseIntPipe().transform("0"), 0);
    });
  });

  describe("transform: numeric values", () => {
    it("passes through a finite integer number", () => {
      assertEquals(new ParseIntPipe().transform(10), 10);
    });

    it("passes through 0", () => {
      assertEquals(new ParseIntPipe().transform(0), 0);
    });
  });

  describe("transform:  optional nil handling", () => {
    it("returns null when optional and value is null", () => {
      const pipe = new ParseIntPipe({ optional: true });

      assertEquals(pipe.transform(null), null);
    });

    it("returns undefined when optional and value is undefined", () => {
      const pipe = new ParseIntPipe({ optional: true });

      assertEquals(pipe.transform(undefined), undefined);
    });
  });

  describe("transform: invalid inputs", () => {
    it("throws BadRequestException for a float string", () => {
      assertThrows(
        () => new ParseIntPipe().transform("1.5"),
        BadRequestException,
      );
    });

    it("throws BadRequestException for a non-numeric string", () => {
      assertThrows(
        () => new ParseIntPipe().transform("abc"),
        BadRequestException,
      );
    });

    it("throws BadRequestException for Infinity", () => {
      assertThrows(
        () => new ParseIntPipe().transform(Infinity),
        BadRequestException,
      );
    });

    it("throws BadRequestException for -Infinity", () => {
      assertThrows(
        () => new ParseIntPipe().transform(-Infinity),
        BadRequestException,
      );
    });

    it("throws BadRequestException for null when not optional", () => {
      assertThrows(
        () => new ParseIntPipe().transform(null),
        BadRequestException,
      );
    });

    it("throws BadRequestException for undefined when not optional", () => {
      assertThrows(
        () => new ParseIntPipe().transform(undefined),
        BadRequestException,
      );
    });

    it("calls exceptionFactory with the validation message", () => {
      const factory = spy((_msg: string) => new Error("custom"));
      const pipe = new ParseIntPipe({ exceptionFactory: factory });

      assertThrows(() => pipe.transform("1.5"));
      assertSpyCalls(factory, 1);
    });
  });
});
