import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { describe, it } from "node:test";
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

    it("works without options", () => {
      assertEquals(
        new ParseDatePipe().transform("2024-01-15")?.toISOString(),
        "2024-01-15T00:00:00.000Z",
      );
    });

    for (
      const [input, expected] of [
        ["2024-01-15", "2024-01-15T00:00:00.000Z"],
        ["2024-02-29", "2024-02-29T00:00:00.000Z"],
        ["2000-02-29", "2000-02-29T00:00:00.000Z"],
        ["2024-12-31", "2024-12-31T00:00:00.000Z"],
        ["2024-01-15T10:30Z", "2024-01-15T10:30:00.000Z"],
        ["2024-01-15T10:30:15+01:00", "2024-01-15T09:30:15.000Z"],
        ["2024-01-15T23:59:59-02:30", "2024-01-16T02:29:59.000Z"],
        ["2024-01-15t10:30:00.123456z", "2024-01-15T10:30:00.123Z"],
      ] as const
    ) {
      it(`parses "${input}" as ${expected}`, () => {
        assertEquals(
          new ParseDatePipe().transform(input)?.toISOString(),
          expected,
        );
      });
    }

    it("parses a date-time without offset as local time", () => {
      assertEquals(
        new ParseDatePipe().transform("2024-01-15T10:30")?.getTime(),
        new Date(2024, 0, 15, 10, 30).getTime(),
      );
    });
  });

  describe("transform: valid numeric timestamp", () => {
    it("parses a Unix millisecond timestamp", () => {
      const ts = 1705276800000;
      const result = new ParseDatePipe({ optional: false }).transform(ts);

      assertInstanceOf(result, Date);
      assertEquals((result as Date).getTime(), ts);
    });

    it("parses 0 as the epoch", () => {
      assertEquals(new ParseDatePipe().transform(0)?.getTime(), 0);
    });

    for (const input of ["1705276800000", "0", "-1000"]) {
      it(`parses the timestamp string "${input}"`, () => {
        assertEquals(
          new ParseDatePipe().transform(input)?.getTime(),
          Number(input),
        );
      });
    }
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

    it("throws BadRequestException for empty string", () => {
      assertThrows(
        () => (new ParseDatePipe({ optional: true })).transform(""),
        BadRequestException,
        "Validation failed (no Date provided)",
      );
    });

    for (
      const input of [
        "2024-02-30",
        "2023-02-29",
        "1900-02-29",
        "2024-04-31",
        "2024-13-01",
        "2024-00-10",
        "2024-01-00",
        "2024-01-15T24:00:00Z",
        "2024-01-15T10:60Z",
        "2024-01-15T10:00:60Z",
        "2024-01-15T10:00+0100",
        "2024-01-15T10:00+24:00",
        "2024-01-15 10:00",
        "2024-01",
        "1.5",
        "3.5",
        "foo 2",
        "Hello 2020",
        "Jan 5 2024",
        " 2024-01-15",
        "99999999999999999999",
        NaN,
        Infinity,
      ]
    ) {
      it(`throws BadRequestException for ${JSON.stringify(input)}`, () => {
        assertThrows(
          () => new ParseDatePipe().transform(input),
          BadRequestException,
          "Validation failed (invalid date format)",
        );
      });
    }

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
