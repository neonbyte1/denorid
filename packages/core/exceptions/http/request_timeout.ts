import { STATUS_TEXT, StatusCode } from "../../http/status.ts";
import { HttpException, type HttpExceptionOptions } from "./base.ts";

/**
 * Defines an HTTP exception for *Request Timeout* type errors.
 */
export class RequestTimeoutException extends HttpException {
  /**
   * Instantiate an `RequestTimeoutException` exception.
   *
   * @example
   * ```ts
   * throw new RequestTimeoutException();
   * ```
   *
   * @usageNotes
   * The HTTP response status wll be 408.
   * - The `objectOrError` argument defines the JSON response body or the message string
   * - The `descriptionOrOptions` argument contains either a short description of the HTTP error
   * or an options {@linkcode HttpExceptionOptions} object used to provide an underlying error cause.
   *
   * By default, the JSON response body contains two properties:
   * - `statusCode`: this will be the value 408.
   * - `message`: the string `"Request Timeout"` by default; override this by supplying a string
   * in the `objectOrError` parameter.
   *
   * If the parameter `objectOrError` is a string, the response body will contain an additional
   * property, `error`, with a short description of the HTTP error. To override the entire JSON
   * response body, pass an object instead. Denorid will serialize the object and return it
   * as the JSON response body.
   *
   * @param {string|object} objectOrError Describing the error condition
   * @param {string|HttpExceptionOptions} descriptionOrOptions Either a short description of the HTTP error
   * or an options {@linkcode HttpExceptionOptions} object used to provide an underlying error cause
   */
  public constructor(
    objectOrError?: string | Record<string, unknown>,
    descriptionOrOptions?: string | HttpExceptionOptions,
  ) {
    const { description, httpExceptionOptions } = HttpException
      .extractDescriptionAndOptionsFrom(
        descriptionOrOptions ?? STATUS_TEXT[StatusCode.RequestTimeout],
      );

    super(
      HttpException.createBody(
        objectOrError,
        description!,
        StatusCode.RequestTimeout,
      ),
      StatusCode.RequestTimeout,
      httpExceptionOptions,
    );
  }
}
