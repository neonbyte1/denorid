import type { MethodDecorator } from "@denorid/injector";
import {
  createRequestMappingDecorator,
  type RequestMappingValidationMetadata,
} from "./_request_mapping.ts";

type RequestValidationDecoratorFactory = (dto: unknown) => MethodDecorator;

function createRequestValidationDecorator(
  type: RequestMappingValidationMetadata["type"],
): RequestValidationDecoratorFactory {
  return (dto: unknown): MethodDecorator => {
    return createRequestMappingDecorator({
      name: type === "json" ? "Body" : "Form",
      initializer: (entry): void => {
        entry.validation = { type, dto };
      },
    });
  };
}

/**
 * Decorator that parses and validates the request body as JSON, binding it to
 * the route handler's DTO parameter.
 *
 * @param {unknown} dto - The Zod schema or class used to validate the parsed JSON body.
 * @return {MethodDecorator} A method decorator that registers JSON body validation for the route.
 */
export const Body: RequestValidationDecoratorFactory =
  createRequestValidationDecorator("json");

/**
 * Decorator that parses and validates the request body as form data, binding it
 * to the route handler's DTO parameter.
 *
 * @param {unknown} dto - The Zod schema or class used to validate the parsed form data.
 * @return {MethodDecorator} A method decorator that registers form data validation for the route.
 */
export const Form: RequestValidationDecoratorFactory =
  createRequestValidationDecorator("form");
