import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "node:test";
import { z, type ZodError } from "zod";
import { StatusCode } from "../../http/status.ts";
import { BadRequestException } from "./bad_request.ts";
import { HttpException } from "./base.ts";
import { ZodValidationException } from "./zod_validation.ts";

function makeZodError(messages: string[]): ZodError {
  return {
    issues: messages.map((message) => ({ message, path: [] })),
  } as unknown as ZodError;
}

function parseError(schema: z.ZodType, input: unknown): ZodError {
  const result = schema.safeParse(input);

  if (result.success) {
    throw new Error("expected the input to fail validation");
  }

  return result.error;
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

  it("prefixes each message with the path of the failing field", () => {
    const err = new ZodValidationException(
      parseError(
        z.object({
          name: z.string(),
          email: z.string(),
          address: z.object({ zip: z.string() }),
          tags: z.array(z.string()),
        }),
        { address: {}, tags: ["a", 1] },
      ),
    );

    assertEquals(err.response, {
      statusCode: StatusCode.BadRequest,
      message: [
        "name: Invalid input: expected string, received undefined",
        "email: Invalid input: expected string, received undefined",
        "address.zip: Invalid input: expected string, received undefined",
        "tags.1: Invalid input: expected string, received number",
      ],
      error: "Bad Request",
    });
  });

  it("keeps the plain message for an issue on the root value", () => {
    const err = new ZodValidationException(parseError(z.string(), 1));

    assertEquals(err.response, {
      statusCode: StatusCode.BadRequest,
      message: ["Invalid input: expected string, received number"],
      error: "Bad Request",
    });
  });

  it("renders symbol path segments", () => {
    const err = new ZodValidationException({
      issues: [{ message: "bad", path: [Symbol("key"), "a"] }],
    } as unknown as ZodError);

    assertEquals(err.response, {
      statusCode: StatusCode.BadRequest,
      message: ["Symbol(key).a: bad"],
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

  it("keeps the Bad Request label when options only carry a cause", () => {
    const cause = new Error("original");
    const err = new ZodValidationException(
      makeZodError(["field required"]),
      { cause },
    );

    assertEquals(err.cause, cause);
    assertEquals(err.response, {
      statusCode: StatusCode.BadRequest,
      message: ["field required"],
      error: "Bad Request",
    });
  });
});
