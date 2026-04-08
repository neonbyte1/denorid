import type { Type } from "@denorid/injector";
import { type ErrorHttpStatusCode, StatusCode } from "../../http/status.ts";
import { BadGatewayException } from "./bad_gateway.ts";
import { BadRequestException } from "./bad_request.ts";
import type { HttpException } from "./base.ts";
import { ConflictException } from "./conflict.ts";
import { ContentTooLargeException } from "./content_too_large.ts";
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
import { RequestTimeoutException } from "./request_timeout.ts";
import { ServiceUnavailableException } from "./service_unavailable.ts";
import { TeapotException } from "./teapot.ts";
import { TooEarlyException } from "./too_early.ts";
import { UnauthorizedException } from "./unauthorized.ts";
import { UnavailableForLegalReasonsException } from "./unavailable_for_legal_reasons.ts";
import { UnprocessableContentException } from "./unprocessable_context.ts";
import { UnsupportedMediaTypeException } from "./unsupported_media_type.ts";

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
    [StatusCode.RequestTimeout]: RequestTimeoutException,
    [StatusCode.ServiceUnavailable]: ServiceUnavailableException,
    [StatusCode.Teapot]: TeapotException,
    [StatusCode.TooEarly]: TooEarlyException,
    [StatusCode.Unauthorized]: UnauthorizedException,
    [StatusCode.UnavailableForLegalReasons]:
      UnavailableForLegalReasonsException,
    [StatusCode.UnprocessableContent]: UnprocessableContentException,
    [StatusCode.UnsupportedMediaType]: UnsupportedMediaTypeException,
  };
