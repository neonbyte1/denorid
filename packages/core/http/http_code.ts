import type { MethodDecorator } from "@denorid/injector";
import { createRequestMappingDecorator } from "./_request_mapping.ts";
import type { StatusCode } from "./status.ts";

/**
 * Overrides the default HTTP response status code for a route handler.
 *
 * @param {StatusCode} statusCode - The HTTP status code to send in the response.
 * @return {MethodDecorator} A method decorator that sets the response status code.
 */
export function HttpCode(statusCode: StatusCode): MethodDecorator {
  return createRequestMappingDecorator({
    name: "HttpCode",
    initializer: (entry): void => {
      entry.statusCode = statusCode;
    },
  });
}
