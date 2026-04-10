import {
  type ClassMethodDecoratorInitializer,
  InvalidStaticMemberDecoratorUsageError,
  type MethodDecorator,
  type Type,
} from "@denorid/injector";
import { CONTROLLER_REQUEST_MAPPING } from "../_constants.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import { isNil } from "../type_guards.ts";
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
  guards?: Set<CanActivate | CanActivateFn>;
}

export function getRequestMappingMetadata(
  ctx: ClassDecoratorContext,
): RequestMappingMetadata[];
export function getRequestMappingMetadata<
  T extends object,
  V extends ClassMethodDecoratorInitializer<T>,
>(
  ctx: ClassMethodDecoratorContext<T, V>,
): RequestMappingMetadata[];
export function getRequestMappingMetadata(
  target: Type,
): RequestMappingMetadata[] | undefined;
export function getRequestMappingMetadata(
  ctxOrTarget: ClassDecoratorContext | ClassMethodDecoratorContext | Type,
): RequestMappingMetadata[] | undefined {
  if ("kind" in ctxOrTarget) {
    return (ctxOrTarget.metadata[CONTROLLER_REQUEST_MAPPING] ??=
      []) as RequestMappingMetadata[];
  }

  const metadata = ctxOrTarget[Symbol.metadata];

  if (!isNil(metadata)) {
    return (metadata[CONTROLLER_REQUEST_MAPPING] ??=
      []) as RequestMappingMetadata[];
  }

  return undefined;
}

export function preserveRequestMappingMetadata<
  T extends object,
  V extends ClassMethodDecoratorInitializer<T>,
>(
  ctx: ClassMethodDecoratorContext<T, V>,
): RequestMappingMetadata {
  const metadata = getRequestMappingMetadata(ctx);

  let entry = metadata.find(({ name }) => name === ctx.name);

  if (!entry) {
    entry = { name: ctx.name };

    metadata.push(entry);
  }

  return entry;
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

    const entry = preserveRequestMappingMetadata(ctx);

    decorator.initializer(entry);

    return target;
  };
}
