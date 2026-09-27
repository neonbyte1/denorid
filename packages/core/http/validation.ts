import type { MethodDecorator } from "@denorid/injector";
import type { ZodType } from "zod";
import {
  createRequestMappingDecorator,
  type RequestMappingValidationMetadata,
} from "./_request_mapping.ts";

type RequestValidationDecoratorFactory = (dto: ZodType) => MethodDecorator;

function createRequestValidationDecorator(
  type: RequestMappingValidationMetadata["type"],
): RequestValidationDecoratorFactory {
  return (dto: ZodType): MethodDecorator => {
    return createRequestMappingDecorator({
      name: type === "json" ? "Body" : "Form",
      initializer: (entry): void => {
        entry.validation = { type, dto };
      },
    });
  };
}

/**
 * Decorator that parses the request body as JSON and validates it against a
 * Zod schema, binding the result to the route handler's DTO parameter.
 *
 * @param {ZodType} dto - The Zod schema the parsed JSON body is validated against.
 * @return {MethodDecorator} A method decorator that registers JSON body validation for the route.
 */
export const Body: RequestValidationDecoratorFactory =
  createRequestValidationDecorator("json");

/**
 * Decorator that parses the request body as form data and validates it
 * against a Zod schema, binding the result to the route handler's DTO
 * parameter.
 *
 * @param {ZodType} dto - The Zod schema the parsed form data is validated against.
 * @return {MethodDecorator} A method decorator that registers form data validation for the route.
 */
export const Form: RequestValidationDecoratorFactory =
  createRequestValidationDecorator("form");
