import type { StatusCode } from "../../http/status.ts";
import { IntrinsicException } from "../intrinsic.ts";

/**
 * Valid shapes for the `message` field inside an {@linkcode HttpExceptionBody}.
 * Accepts a single string, an array of validation-error strings, or a numeric code.
 */
export type HttpExceptionBodyMessage = string | string[] | number;

/**
 * Standard JSON body returned by {@linkcode HttpException} responses.
 *
 * @example
 * ```json
 * { "statusCode": 404, "message": "Not Found" }
 * { "statusCode": 400, "message": "email must be an email", "error": "Bad Request" }
 * ```
 */
export interface HttpExceptionBody {
  message: HttpExceptionBodyMessage;
  error?: string;
  statusCode: StatusCode;
}

/**
 * Options accepted by {@linkcode HttpException} and all subclasses.
 */
export interface HttpExceptionOptions {
  /** Original cause of the error, forwarded to `Error.cause`. */
  cause?: unknown;
  /** Short human-readable description of the error. */
  description?: string;
}

/**
 * Parsed result of {@linkcode HttpException.extractDescriptionAndOptionsFrom}.
 */
export interface HttpExceptionDescriptionAndOptions {
  /** Short human-readable description of the error. */
  description?: string;
  /** Remaining options after the description has been extracted. */
  httpExceptionOptions?: HttpExceptionOptions;
}

/**
 * Base class for all HTTP-layer exceptions in Denorid.
 *
 * Subclass this to create domain-specific HTTP exceptions, or use one of the
 * pre-built subclasses (e.g. `NotFoundException`, `BadRequestException`).
 *
 * @example Throwing with a plain message
 * ```ts
 * throw new HttpException("Something went wrong", StatusCode.InternalServerError);
 * ```
 *
 * @example Throwing with a custom JSON body
 * ```ts
 * throw new HttpException(
 *   { message: "Validation failed", fields: ["email"] },
 *   StatusCode.UnprocessableEntity,
 * );
 * ```
 */
export class HttpException extends IntrinsicException {
  /** The raw response value passed to the constructor. */
  public readonly response: string | Record<string, unknown>;

  /**
   * @param response - A string message or an object that will be serialized as
   *   the JSON response body.
   * @param status - The HTTP status code to send.
   * @param options - Optional {@linkcode HttpExceptionOptions} (cause, description).
   */
  public constructor(
    response: string | object,
    public readonly status: StatusCode,
    public readonly options?: HttpExceptionOptions,
  ) {
    super("");

    this.response = response as string | Record<string, unknown>;

    if (this.options?.cause) {
      this.cause = this.options.cause;
    }

    const message = typeof this.response === "string"
      ? this.response
      : typeof this.response === "object" &&
          typeof this.response.message === "string"
      ? this.response.message
      : this.constructor?.name.match(/[A-Z][a-z]+|[0-9]+/g)?.join(" ");

    this.message = message ?? "Error";
    this.name = this.constructor.name;
  }

  /**
   * Builds an {@linkcode HttpExceptionBody} with only `message` and `statusCode`.
   * Use when there is no primary error label — the body will not include an `error` field.
   *
   * @param {undefined | null | ""} nil - Must be `undefined`, `null`, or `""` to select this overload.
   * @param {HttpExceptionBodyMessage} message - The human-readable message (string, string array, or numeric code).
   * @param {number} statusCode - The HTTP status code to embed in the body.
   * @returns {HttpExceptionBody}
   */
  public static createBody(
    nil: undefined | null | "",
    message: HttpExceptionBodyMessage,
    statusCode: number,
  ): HttpExceptionBody;
  /**
   * Builds an {@linkcode HttpExceptionBody} with `message`, `error`, and `statusCode`.
   * Use when a scalar message and a short error label (e.g. `"Bad Request"`) are both available.
   *
   * @param {HttpExceptionBodyMessage} message - The human-readable message (string, string array, or numeric code).
   * @param {string} error - A short error label, typically the HTTP status phrase.
   * @param {number} statusCode - The HTTP status code to embed in the body.
   * @returns {HttpExceptionBody}
   */
  public static createBody(
    message: HttpExceptionBodyMessage,
    error: string,
    statusCode: number,
  ): HttpExceptionBody;
  /**
   * Builds a body from an object or scalar, merging `message` and `statusCode` onto it.
   * When `objectOrError` is a scalar (string, string[], or number) the result includes an
   * `error` field; when it is a plain object it is returned as-is with `message` and
   * `statusCode` spread in.
   *
   * @param {string | string[] | Record<string, unknown> | undefined} objectOrError - Either a scalar message or an arbitrary object to merge into.
   * @param {HttpExceptionBodyMessage} message - Fallback message used when `objectOrError` is an object.
   * @param {number} statusCode - The HTTP status code to embed in the body.
   * @returns {HttpExceptionBody | Record<string, unknown>}
   */
  public static createBody(
    objectOrError: string | string[] | Record<string, unknown> | undefined,
    message: HttpExceptionBodyMessage,
    statusCode: number,
  ): HttpExceptionBody | Record<string, unknown>;
  /**
   * Passthrough overload — returns a fully-formed custom body as-is without modification.
   * Use when the caller has already assembled the complete response object.
   *
   * @param {Body} custom - A pre-built body object; returned unchanged.
   * @returns {Body}
   */
  public static createBody<Body extends Record<string, unknown>>(
    custom: Body,
  ): Body;
  public static createBody<Body extends Record<string, unknown>>(
    arg0: null | HttpExceptionBodyMessage | Body,
    arg1?: HttpExceptionBodyMessage | string,
    statusCode?: number,
  ): HttpExceptionBody | Body {
    if (!arg0) {
      return {
        message: arg1!,
        statusCode: statusCode!,
      };
    }

    if (
      typeof arg0 === "string" || Array.isArray(arg0) ||
      typeof arg0 === "number"
    ) {
      return {
        message: arg0,
        error: arg1 as string,
        statusCode: statusCode!,
      };
    }

    return arg0;
  }

  /**
   * Splits a `string | HttpExceptionOptions` argument into its `description`
   * and `httpExceptionOptions` parts so constructor overloads stay concise.
   *
   * @param descriptionOrOptions - Either a plain description string or a full
   *   {@linkcode HttpExceptionOptions} object.
   * @returns An {@linkcode HttpExceptionDescriptionAndOptions} with both fields
   *   populated (options will be an empty object when a plain string is given).
   */
  public static extractDescriptionAndOptionsFrom(
    descriptionOrOptions: string | HttpExceptionOptions,
  ): HttpExceptionDescriptionAndOptions {
    const description = typeof descriptionOrOptions === "string"
      ? descriptionOrOptions
      : descriptionOrOptions?.description;

    const httpExceptionOptions = typeof descriptionOrOptions === "string"
      ? {}
      : descriptionOrOptions;

    return {
      description,
      httpExceptionOptions,
    };
  }
}
