import { assertEquals, assertThrows } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { describe, it } from "node:test";
import { BadRequestException } from "../exceptions/http/bad_request.ts";
import { ParseEnumPipe } from "./parse_enum.ts";

enum Direction {
  Up = "UP",
  Down = "DOWN",
}

enum Priority {
  Low = 1,
  High = 2,
}

enum Color {
  Red = 0,
  Green = 1,
}

enum Mixed {
  One = 1,
  Bee = "b",
}

describe("ParseEnumPipe", () => {
  describe("constructor", () => {
    it("throws when enumType is falsy", () => {
      assertThrows(
        () => new ParseEnumPipe(null!),
        Error,
        `"ParseEnumPipe" requires the "enumType" argument (to validate input values).`,
      );
    });

    it("does not throw for a valid enum object", () => {
      new ParseEnumPipe(Direction);
    });
  });

  describe("transform:  string enum", () => {
    it("returns the matching string enum member", () => {
      const pipe = new ParseEnumPipe<Direction>(Direction);

      assertEquals(pipe.transform("UP"), Direction.Up);
    });

    it("returns another matching string enum member", () => {
      const pipe = new ParseEnumPipe<Direction>(Direction);

      assertEquals(pipe.transform("DOWN"), Direction.Down);
    });
  });

  describe("transform:  numeric enum", () => {
    it("returns the matching numeric member for a numeric string", () => {
      const pipe = new ParseEnumPipe<Priority>(Priority);

      assertEquals(pipe.transform("1"), Priority.Low);
    });

    it("returns the matching numeric member for another numeric string", () => {
      const pipe = new ParseEnumPipe<Priority>(Priority);

      assertEquals(pipe.transform("2"), Priority.High);
    });

    it("returns the zero member for a numeric value or string", () => {
      const pipe = new ParseEnumPipe<Color>(Color);

      assertEquals(pipe.transform(0 as unknown as string), Color.Red);
      assertEquals(pipe.transform("0"), Color.Red);
    });

    it("accepts the values of a heterogeneous enum", () => {
      const pipe = new ParseEnumPipe<Mixed>(Mixed);

      assertEquals(pipe.transform("1"), Mixed.One);
      assertEquals(pipe.transform("b"), Mixed.Bee);
    });
  });

  describe("transform:  values that are not members", () => {
    for (
      const input of ["Red", "Green", "", " ", " 1 ", "0x1", "1e0", "+1", null]
    ) {
      it(`rejects ${JSON.stringify(input)} for a numeric enum`, () => {
        const pipe = new ParseEnumPipe<Color>(Color);

        assertThrows(
          () => pipe.transform(input!),
          BadRequestException,
          "Validation failed (enum number or enum string is expected).",
        );
      });
    }

    it("rejects the member name of a heterogeneous enum", () => {
      const pipe = new ParseEnumPipe<Mixed>(Mixed);

      assertThrows(() => pipe.transform("One"), BadRequestException);
    });
  });

  describe("transform:  optional nil handling", () => {
    it("returns null when optional and value is null", () => {
      const pipe = new ParseEnumPipe<Direction>(Direction, { optional: true });

      assertEquals(pipe.transform(null!), null);
    });

    it("returns undefined when optional and value is undefined", () => {
      const pipe = new ParseEnumPipe<Direction>(Direction, { optional: true });

      assertEquals(pipe.transform(undefined!), undefined);
    });
  });

  describe("transform:  invalid inputs", () => {
    it("throws BadRequestException for an unrecognised string", () => {
      const pipe = new ParseEnumPipe<Direction>(Direction);

      assertThrows(() => pipe.transform("LEFT"), BadRequestException);
    });

    it("throws BadRequestException for a numeric string not in the enum", () => {
      const pipe = new ParseEnumPipe<Priority>(Priority);

      assertThrows(() => pipe.transform("99"), BadRequestException);
    });

    it("calls exceptionFactory with the validation message", () => {
      const factory = spy((_msg: string) => new Error("custom"));
      const pipe = new ParseEnumPipe<Direction>(Direction, {
        exceptionFactory: factory,
      });

      assertThrows(() => pipe.transform("INVALID"));
      assertSpyCalls(factory, 1);
      assertSpyCall(factory, 0, {
        args: ["Validation failed (enum number or enum string is expected)."],
      });
    });
  });
});
