import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy } from "@std/testing/mock";
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

describe("ParseEnumPipe", () => {
  describe("constructor", () => {
    it("throws when enumType is falsy", () => {
      assertThrows(
        () => new ParseEnumPipe(null!),
        Error,
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
    });
  });
});
