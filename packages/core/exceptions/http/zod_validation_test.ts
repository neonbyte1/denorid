import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ZodError } from "zod";
import { StatusCode } from "../../http/status.ts";
import { BadRequestException } from "./bad_request.ts";
import { HttpException } from "./base.ts";
import { ZodValidationException } from "./zod_validation.ts";

function makeZodError(messages: string[]): ZodError {
  return {
    issues: messages.map((message) => ({ message })),
  } as unknown as ZodError;
}

describe("ZodValidationException", () => {
  it("extends BadRequestException", () => {
    assertInstanceOf(
      new ZodValidationException(makeZodError([])),
      BadRequestException,
    );
  });

  it("extends HttpException", () => {
    assertInstanceOf(
      new ZodValidationException(makeZodError([])),
      HttpException,
    );
  });

  it("sets status to 400", () => {
    assertEquals(
      new ZodValidationException(makeZodError([])).status,
      StatusCode.BadRequest,
    );
  });

  it("maps zod issue messages into response.message array", () => {
    const err = new ZodValidationException(
      makeZodError(["email is invalid", "name is required"]),
    );

    assertEquals(err.response, {
      statusCode: StatusCode.BadRequest,
      message: ["email is invalid", "name is required"],
      error: "Bad Request",
    });
  });

  it("handles a single zod issue", () => {
    const err = new ZodValidationException(makeZodError(["must be a string"]));

    assertEquals(err.response, {
      statusCode: StatusCode.BadRequest,
      message: ["must be a string"],
      error: "Bad Request",
    });
  });

  it("handles empty issues array", () => {
    const err = new ZodValidationException(makeZodError([]));

    assertEquals(err.response, {
      statusCode: StatusCode.BadRequest,
      message: [],
      error: "Bad Request",
    });
  });

  it("accepts a string description override", () => {
    const err = new ZodValidationException(
      makeZodError(["field required"]),
      "Validation failed",
    );

    assertEquals(err.response, {
      statusCode: StatusCode.BadRequest,
      message: ["field required"],
      error: "Validation failed",
    });
  });

  it("accepts HttpExceptionOptions with cause", () => {
    const cause = new Error("original");
    const err = new ZodValidationException(
      makeZodError(["field required"]),
      { cause, description: "Validation failed" },
    );

    assertEquals(err.cause, cause);
    assertEquals(err.response, {
      statusCode: StatusCode.BadRequest,
      message: ["field required"],
      error: "Validation failed",
    });
  });
});
