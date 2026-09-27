import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { describe, it } from "node:test";
import { BadRequestException } from "../exceptions/http/bad_request.ts";
import { HttpException } from "../exceptions/http/base.ts";
import { NotFoundException } from "../exceptions/http/not_found.ts";
import { StatusCode } from "../http/status.ts";
import { BaseParsePipe } from "./base.ts";
import type { ArgumentMetadata } from "./pipe_transform.ts";

const METADATA: ArgumentMetadata = { type: "param" };

class StubPipe extends BaseParsePipe<string | undefined, string | undefined> {
  public transform(
    value: string | undefined,
    _metadata: ArgumentMetadata,
  ): string | undefined {
    if (!value) {
      throw this.exceptionFactory("validation failed");
    }
    return value;
  }
}

describe("BaseParsePipe", () => {
  describe("default options", () => {
    it("throws BadRequestException via the default exceptionFactory", () => {
      const pipe = new StubPipe();

      let caught: unknown;

      try {
        pipe.transform(undefined, METADATA);
      } catch (e) {
        caught = e;
      }

      assertInstanceOf(caught, BadRequestException);
    });
  });

  describe("custom statusCode", () => {
    it("produces an exception for the provided statusCode", () => {
      const pipe = new StubPipe({ statusCode: StatusCode.NotFound });

      let caught: unknown;

      try {
        pipe.transform(undefined, METADATA);
      } catch (e) {
        caught = e;
      }

      assertInstanceOf(caught, NotFoundException);
    });

    for (
      const statusCode of [
        StatusCode.ProxyAuthenticationRequired,
        StatusCode.RangeNotSatisfiable,
        StatusCode.ExpectationFailed,
        StatusCode.FailedDependency,
        StatusCode.UpgradeRequired,
        StatusCode.PreconditionRequired,
        StatusCode.TooManyRequests,
      ] as const
    ) {
      it(`throws an HttpException with status ${statusCode}`, () => {
        const pipe = new StubPipe({ statusCode });

        const caught = assertThrows(() => pipe.transform(undefined, METADATA));

        assertInstanceOf(caught, HttpException);
        assertEquals(caught.status, statusCode);
        assertEquals(caught.message, "validation failed");
      });
    }
  });

  describe("custom exceptionFactory", () => {
    it("calls the provided factory with the error message", () => {
      const customErr = new Error("custom");
      const factory = spy((_msg: string) => customErr);
      const pipe = new StubPipe({ exceptionFactory: factory });

      let caught: unknown;

      try {
        pipe.transform(undefined, METADATA);
      } catch (e) {
        caught = e;
      }

      assertStrictEquals(caught, customErr);
      assertSpyCalls(factory, 1);
      assertSpyCall(factory, 0, { args: ["validation failed"] });
    });
  });

  describe("transform", () => {
    it("passes the value through when valid", () => {
      const pipe = new StubPipe();

      assertStrictEquals(pipe.transform("hello", METADATA), "hello");
    });
  });
});
