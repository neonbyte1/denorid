import {
  type ClassMethodDecoratorInitializer,
  InvalidStaticMemberDecoratorUsageError,
  type MethodDecorator,
} from "@denorid/injector";
import { CONTROLLER_REQUEST_MAPPING } from "../_constants.ts";
import type { HttpMethod } from "./method.ts";
import type { StatusCode } from "./status.ts";

export interface RequestMappingValidationMetadata {
  type: "form" | "json";
  dto: unknown;
}

export interface RequestMappingMetadata {
  path?: string | string[];
  method?: HttpMethod;
  statusCode?: StatusCode;
  name: string | symbol;
  validation?: RequestMappingValidationMetadata;
}

export function createRequestMappingDecorator(
  decorator: {
    name: string;
    initializer: (entry: RequestMappingMetadata) => void;
  },
): MethodDecorator {
  return function <
    T extends object,
    V extends ClassMethodDecoratorInitializer<T>,
  >(
    target: V,
    ctx: ClassMethodDecoratorContext<T, V>,
  ): V {
    if (ctx.static) {
      throw new InvalidStaticMemberDecoratorUsageError(
        decorator.name,
        ctx.name,
        "function",
      );
    }

    const metadata =
      (ctx.metadata[CONTROLLER_REQUEST_MAPPING] ??=
        []) as RequestMappingMetadata[];

    let entry = metadata.find(({ name }) => name === ctx.name);

    if (!entry) {
      entry = { name: ctx.name };

      metadata.push(entry);
    }

    decorator.initializer(entry);

    return target;
  };
}
