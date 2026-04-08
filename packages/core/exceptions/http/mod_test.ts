import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { STATUS_TEXT, StatusCode } from "../../http/status.ts";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ContentTooLargeException,
  ExpectationFailedException,
  FailedDependencyException,
  ForbiddenException,
  GatewayTimeoutException,
  GoneException,
  HttpException,
  InsufficientStorageException,
  InternalServerErrorException,
  LockedException,
  MethodNotAllowedException,
  NotAcceptableException,
  NotFoundException,
  NotImplementedException,
  PaymentRequiredException,
  PreconditionFailedException,
  PreconditionRequiredException,
  ProxyAuthenticationRequiredException,
  RangeNotSatisfiableException,
  RequestTimeoutException,
  ServiceUnavailableException,
  TeapotException,
  TooEarlyException,
  TooManyRequestsException,
  UnauthorizedException,
  UnavailableForLegalReasonsException,
  UnprocessableContentException,
  UnsupportedMediaTypeException,
  UpgradeRequiredException,
} from "./mod.ts";

type HttpExceptionConstructor = new (
  objectOrError?: string | Record<string, unknown>,
  descriptionOrOptions?: string,
) => HttpException;

const cases: Array<[HttpExceptionConstructor, StatusCode]> = [
  [BadGatewayException, StatusCode.BadGateway],
  [BadRequestException, StatusCode.BadRequest],
  [ConflictException, StatusCode.Conflict],
  [ContentTooLargeException, StatusCode.ContentTooLarge],
  [ExpectationFailedException, StatusCode.ExpectationFailed],
  [FailedDependencyException, StatusCode.FailedDependency],
  [ForbiddenException, StatusCode.Forbidden],
  [GatewayTimeoutException, StatusCode.GatewayTimeout],
  [GoneException, StatusCode.Gone],
  [InsufficientStorageException, StatusCode.InsufficientStorage],
  [InternalServerErrorException, StatusCode.InternalServerError],
  [LockedException, StatusCode.Locked],
  [MethodNotAllowedException, StatusCode.MethodNotAllowed],
  [NotAcceptableException, StatusCode.NotAcceptable],
  [NotFoundException, StatusCode.NotFound],
  [NotImplementedException, StatusCode.NotImplemented],
  [PaymentRequiredException, StatusCode.PaymentRequired],
  [PreconditionFailedException, StatusCode.PreconditionFailed],
  [PreconditionRequiredException, StatusCode.PreconditionRequired],
  [
    ProxyAuthenticationRequiredException,
    StatusCode.ProxyAuthenticationRequired,
  ],
  [RangeNotSatisfiableException, StatusCode.RangeNotSatisfiable],
  [RequestTimeoutException, StatusCode.RequestTimeout],
  [ServiceUnavailableException, StatusCode.ServiceUnavailable],
  [TeapotException, StatusCode.Teapot],
  [TooEarlyException, StatusCode.TooEarly],
  [TooManyRequestsException, StatusCode.TooManyRequests],
  [UnauthorizedException, StatusCode.Unauthorized],
  [UnavailableForLegalReasonsException, StatusCode.UnavailableForLegalReasons],
  [UnprocessableContentException, StatusCode.UnprocessableContent],
  [UnsupportedMediaTypeException, StatusCode.UnsupportedMediaType],
  [UpgradeRequiredException, StatusCode.UpgradeRequired],
];

for (const [ExceptionClass, code] of cases) {
  describe(ExceptionClass.name, () => {
    it("extends HttpException", () => {
      assertInstanceOf(new ExceptionClass(), HttpException);
    });

    it("sets correct status code", () => {
      assertEquals(new ExceptionClass().status, code);
    });

    it("default response contains statusCode and default message", () => {
      const err = new ExceptionClass();

      const statusText = (STATUS_TEXT as Record<number, string>)[code];

      assertEquals(err.response, {
        statusCode: code,
        message: statusText,
      });
    });

    it("string arg produces response with message and error", () => {
      const err = new ExceptionClass("custom message");
      const statusText = (STATUS_TEXT as Record<number, string>)[code];

      assertEquals(err.response, {
        statusCode: code,
        message: "custom message",
        error: statusText,
      });
    });

    it("object arg is passed through as response", () => {
      const body = { statusCode: code, message: "custom", extra: true };
      const err = new ExceptionClass(body);

      assertEquals(err.response, body);
    });
  });
}
