import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { BadRequestException } from "../exceptions/http/bad_request.ts";
import { ParseDatePipe } from "./parse_date.ts";

describe("ParseDatePipe", () => {
  describe("transform: valid date strings", () => {
    it("parses an ISO date string", () => {
      const result = new ParseDatePipe({ optional: false }).transform(
        "2024-01-15",
      );

      assertInstanceOf(result, Date);
      assertEquals(isNaN((result as Date).getTime()), false);
    });

    it("parses an ISO datetime string", () => {
      const result = new ParseDatePipe({ optional: false }).transform(
        "2024-01-15T10:30:00.000Z",
      );

      assertInstanceOf(result, Date);
    });
  });

  describe("transform: valid numeric timestamp", () => {
    it("parses a Unix millisecond timestamp", () => {
      const ts = 1705276800000;
      const result = new ParseDatePipe({ optional: false }).transform(ts);

      assertInstanceOf(result, Date);
      assertEquals((result as Date).getTime(), ts);
    });
  });

  describe("transform: optional nil handling", () => {
    it("returns null when optional and value is null", () => {
      const pipe = new ParseDatePipe({ optional: true });

      assertEquals(pipe.transform(null), null);
    });

    it("returns undefined when optional and value is undefined", () => {
      const pipe = new ParseDatePipe({ optional: true });

      assertEquals(pipe.transform(undefined), undefined);
    });

    it("returns the default date when optional and value is null", () => {
      const fallback = new Date("2000-01-01");
      const pipe = new ParseDatePipe({
        optional: true,
        default: () => fallback,
      });

      assertEquals(pipe.transform(null), fallback);
    });

    it("returns the default date when optional and value is undefined", () => {
      const fallback = new Date("2000-01-01");
      const pipe = new ParseDatePipe({
        optional: true,
        default: () => fallback,
      });

      assertEquals(pipe.transform(undefined), fallback);
    });
  });

  describe("transform: invalid inputs", () => {
    it("throws BadRequestException for an invalid date string", () => {
      assertThrows(
        () => new ParseDatePipe({ optional: false }).transform("not-a-date"),
        BadRequestException,
      );
    });

    it("throws BadRequestException when value is null and not optional", () => {
      assertThrows(
        () => new ParseDatePipe({ optional: false }).transform(null),
        BadRequestException,
      );
    });

    it("throws BadRequestException when value is undefined and not optional", () => {
      assertThrows(
        () => new ParseDatePipe({ optional: false }).transform(undefined),
        BadRequestException,
      );
    });

    it("throws BadRequestException for empty string (falsy value)", () => {
      assertThrows(
        () => (new ParseDatePipe({ optional: false })).transform(""),
        BadRequestException,
      );
    });

    it("calls exceptionFactory with the validation message", () => {
      const factory = spy((_msg: string) => new Error("custom"));
      const pipe = new ParseDatePipe({
        optional: false,
        exceptionFactory: factory,
      });

      assertThrows(() => pipe.transform("not-a-date"));
      assertSpyCalls(factory, 1);
    });
  });

  describe("toDate: ensure nested ternary operator logic is correct", () => {
    it("returns null unchanged when value is null", () => {
      const pipe = new ParseDatePipe({ optional: false });

      assertEquals(pipe["toDate"](null), null);
    });

    it("returns undefined unchanged when value is undefined", () => {
      const pipe = new ParseDatePipe({ optional: false });

      assertEquals(pipe["toDate"](undefined), undefined);
    });

    it("returns the same Date instance when value is already a Date", () => {
      const pipe = new ParseDatePipe({ optional: false });
      const date = new Date("2024-01-15");

      assertEquals(pipe["toDate"](date), date);
    });
  });
});
