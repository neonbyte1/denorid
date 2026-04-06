import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { StatusCode } from "../../http/status.ts";
import { IntrinsicException } from "../intrinsic.ts";
import { HttpException } from "./mod.ts";

describe("HttpException", () => {
  describe("constructor", () => {
    it("sets message from string response", () => {
      const err = new HttpException("Not found", StatusCode.NotFound);

      assertEquals(err.message, "Not found");
      assertEquals(err.response, "Not found");
      assertEquals(err.status, StatusCode.NotFound);
    });

    it("sets message from object response with string message property", () => {
      const err = new HttpException(
        { message: "Validation failed" },
        StatusCode.BadRequest,
      );

      assertEquals(err.message, "Validation failed");
    });

    it("derives message from constructor name when response object has no string message", () => {
      const err = new HttpException(
        { code: 42 },
        StatusCode.InternalServerError,
      );

      assertEquals(err.message, "Http Exception");
    });

    it("falls back to 'Error' when constructor name does not match pattern", () => {
      class X extends HttpException {}
      const err = new X({ code: 1 }, StatusCode.InternalServerError);

      assertEquals(err.message, "Error");
    });

    it("sets name to constructor name", () => {
      const err = new HttpException("fail", StatusCode.InternalServerError);

      assertEquals(err.name, "HttpException");
    });

    it("sets cause when options.cause is provided", () => {
      const cause = new Error("original");
      const err = new HttpException("fail", StatusCode.InternalServerError, {
        cause,
      });

      assertEquals(err.cause, cause);
    });

    it("does not set cause when options.cause is absent", () => {
      const err = new HttpException("fail", StatusCode.InternalServerError, {
        description: "some description",
      });

      assertEquals(err.cause, undefined);
    });

    it("works without options", () => {
      const err = new HttpException("fail", StatusCode.InternalServerError);

      assertEquals(err.options, undefined);
      assertEquals(err.cause, undefined);
    });

    it("extends IntrinsicException", () => {
      const err = new HttpException("fail", StatusCode.InternalServerError);

      assertInstanceOf(err, IntrinsicException);
    });
  });

  describe("createBody", () => {
    it("returns message and statusCode when first arg is null", () => {
      const body = HttpException.createBody(null, "Not Found", 404);

      assertEquals(body, { message: "Not Found", statusCode: 404 });
    });

    it("returns message and statusCode when first arg is undefined", () => {
      const body = HttpException.createBody(undefined, "Not Found", 404);

      assertEquals(body, { message: "Not Found", statusCode: 404 });
    });

    it("returns message and statusCode when first arg is empty string", () => {
      const body = HttpException.createBody("", "Not Found", 404);

      assertEquals(body, { message: "Not Found", statusCode: 404 });
    });

    it("returns message, error and statusCode when first arg is a string", () => {
      const body = HttpException.createBody("Bad input", "Bad Request", 400);

      assertEquals(body, {
        message: "Bad input",
        error: "Bad Request",
        statusCode: 400,
      });
    });

    it("returns message, error and statusCode when first arg is an array", () => {
      const body = HttpException.createBody(
        ["email must be valid", "name is required"],
        "Bad Request",
        400,
      );

      assertEquals(body, {
        message: ["email must be valid", "name is required"],
        error: "Bad Request",
        statusCode: 400,
      });
    });

    it("returns message, error and statusCode when first arg is a number", () => {
      const body = HttpException.createBody(42, "Custom Error", 400);

      assertEquals(body, {
        message: 42,
        error: "Custom Error",
        statusCode: 400,
      });
    });

    it("returns the object as-is when a single object is provided", () => {
      const custom = {
        foo: "bar",
        statusCode: 400 as StatusCode,
        message: "custom",
      };
      const body = HttpException.createBody(custom);

      assertEquals(body, custom);
    });
  });

  describe("extractDescriptionAndOptionsFrom", () => {
    it("returns description from string and empty httpExceptionOptions", () => {
      const result = HttpException.extractDescriptionAndOptionsFrom("my desc");

      assertEquals(result.description, "my desc");
      assertEquals(result.httpExceptionOptions, {});
    });

    it("returns description and httpExceptionOptions from options object", () => {
      const options = { description: "my desc", cause: new Error("cause") };
      const result = HttpException.extractDescriptionAndOptionsFrom(options);

      assertEquals(result.description, "my desc");
      assertEquals(result.httpExceptionOptions, options);
    });

    it("returns undefined description when options object has no description", () => {
      const options = { cause: new Error("cause") };
      const result = HttpException.extractDescriptionAndOptionsFrom(options);

      assertEquals(result.description, undefined);
      assertEquals(result.httpExceptionOptions, options);
    });
  });
});
