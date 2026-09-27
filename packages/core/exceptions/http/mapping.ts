import type { Type } from "@denorid/injector";
import { type ErrorHttpStatusCode, StatusCode } from "../../http/status.ts";
import { BadGatewayException } from "./bad_gateway.ts";
import { BadRequestException } from "./bad_request.ts";
import type { HttpException } from "./base.ts";
import { ConflictException } from "./conflict.ts";
import { ContentTooLargeException } from "./content_too_large.ts";
import { ExpectationFailedException } from "./expectation_failed.ts";
import { FailedDependencyException } from "./failed_dependency.ts";
import { ForbiddenException } from "./forbidden.ts";
import { GatewayTimeoutException } from "./gateway_timeout.ts";
import { GoneException } from "./gone.ts";
import { InsufficientStorageException } from "./insufficient_storage.ts";
import { InternalServerErrorException } from "./internal_server_error.ts";
import { LockedException } from "./locked.ts";
import { MethodNotAllowedException } from "./method_not_allowed.ts";
import { NotAcceptableException } from "./not_acceptable.ts";
import { NotFoundException } from "./not_found.ts";
import { NotImplementedException } from "./not_implemented.ts";
import { PaymentRequiredException } from "./payment_required.ts";
import { PreconditionFailedException } from "./precondition_failed.ts";
import { PreconditionRequiredException } from "./precondition_required.ts";
import { ProxyAuthenticationRequiredException } from "./proxy_authentication_required.ts";
import { RangeNotSatisfiableException } from "./range_not_satisfiable.ts";
import { RequestTimeoutException } from "./request_timeout.ts";
import { ServiceUnavailableException } from "./service_unavailable.ts";
import { TeapotException } from "./teapot.ts";
import { TooEarlyException } from "./too_early.ts";
import { TooManyRequestsException } from "./too_many_requests.ts";
import { UnauthorizedException } from "./unauthorized.ts";
import { UnavailableForLegalReasonsException } from "./unavailable_for_legal_reasons.ts";
import { UnprocessableContentException } from "./unprocessable_context.ts";
import { UnsupportedMediaTypeException } from "./unsupported_media_type.ts";
import { UpgradeRequiredException } from "./upgrade_required.ts";

/**
 * Maps each HTTP error status code to its corresponding {@link HttpException} class.
 *
 * Use this to resolve the appropriate exception type from a numeric status code at runtime.
 *
 * @example
 * ```ts
 * const ExceptionClass = HttpErrorByCode[StatusCode.NotFound];
 * throw new ExceptionClass("Resource not found");
 * ```
 */
export const HttpErrorByCode: Record<ErrorHttpStatusCode, Type<HttpException>> =
  {
    [StatusCode.BadGateway]: BadGatewayException,
    [StatusCode.BadRequest]: BadRequestException,
    [StatusCode.Conflict]: ConflictException,
    [StatusCode.ExpectationFailed]: ExpectationFailedException,
    [StatusCode.FailedDependency]: FailedDependencyException,
    [StatusCode.Forbidden]: ForbiddenException,
    [StatusCode.GatewayTimeout]: GatewayTimeoutException,
    [StatusCode.Gone]: GoneException,
    [StatusCode.InsufficientStorage]: InsufficientStorageException,
    [StatusCode.InternalServerError]: InternalServerErrorException,
    [StatusCode.Locked]: LockedException,
    [StatusCode.MethodNotAllowed]: MethodNotAllowedException,
    [StatusCode.NotAcceptable]: NotAcceptableException,
    [StatusCode.NotFound]: NotFoundException,
    [StatusCode.NotImplemented]: NotImplementedException,
    [StatusCode.ContentTooLarge]: ContentTooLargeException,
    [StatusCode.PaymentRequired]: PaymentRequiredException,
    [StatusCode.PreconditionFailed]: PreconditionFailedException,
    [StatusCode.PreconditionRequired]: PreconditionRequiredException,
    [StatusCode.ProxyAuthenticationRequired]:
      ProxyAuthenticationRequiredException,
    [StatusCode.RangeNotSatisfiable]: RangeNotSatisfiableException,
    [StatusCode.RequestTimeout]: RequestTimeoutException,
    [StatusCode.ServiceUnavailable]: ServiceUnavailableException,
    [StatusCode.Teapot]: TeapotException,
    [StatusCode.TooEarly]: TooEarlyException,
    [StatusCode.TooManyRequests]: TooManyRequestsException,
    [StatusCode.Unauthorized]: UnauthorizedException,
    [StatusCode.UnavailableForLegalReasons]:
      UnavailableForLegalReasonsException,
    [StatusCode.UnprocessableContent]: UnprocessableContentException,
    [StatusCode.UnsupportedMediaType]: UnsupportedMediaTypeException,
    [StatusCode.UpgradeRequired]: UpgradeRequiredException,
  };
