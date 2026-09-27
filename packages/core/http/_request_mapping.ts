import type {
  ClassMethodDecoratorInitializer,
  MethodDecorator,
  Type,
} from "@denorid/injector";
import type { ZodType } from "zod";
import { CONTROLLER_REQUEST_MAPPING } from "../_constants.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import {
  assertInstanceMember,
  getOwnMetadata,
} from "../websockets/_metadata.ts";
import type { HttpMethod } from "./method.ts";
import type { StatusCode } from "./status.ts";

/**
 * Request body validation stored by `@Body()` and `@Form()`.
 */
export interface RequestMappingValidationMetadata {
  /** Body format: `"json"` for `@Body()`, `"form"` for `@Form()`. */
  type: "form" | "json";
  /** Zod schema the parsed body is validated against. */
  dto: ZodType;
}

/**
 * Route entry stored for every decorated controller method.
 *
 * Entries without a `method` come from helper decorators (`@HttpCode()`,
 * `@Body()`, `@Form()`, method-level `@UseGuards()`) on methods that have no
 * HTTP method decorator; they are not registered as routes.
 */
export interface RequestMappingMetadata {
  /** Route path(s) relative to the controller path; an array lists alternatives. */
  path?: string | string[];
  /** HTTP method of the route. */
  method?: HttpMethod;
  /** Status code sent on success, set by `@HttpCode()`. */
  statusCode?: StatusCode;
  /** Name of the controller method. */
  name: string | symbol;
  /** Request body validation, set by `@Body()` or `@Form()`. */
  validation?: RequestMappingValidationMetadata;
  /** Method-level guards, set by `@UseGuards()`. */
  guards?: Set<CanActivate | CanActivateFn>;
}

/**
 * Copies inherited route entries so a subclass can change them without
 * touching the entries of its parent. The entries and their guard sets are
 * copied; the other values are replaced as a whole and never mutated.
 *
 * @param {RequestMappingMetadata[] | undefined} inherited - Entries of the
 *   parent class, `undefined` when there are none.
 * @return {RequestMappingMetadata[]} The copied entries.
 */
function cloneRequestMapping(
  inherited: RequestMappingMetadata[] | undefined,
): RequestMappingMetadata[] {
  return inherited?.map((entry) =>
    entry.guards ? { ...entry, guards: new Set(entry.guards) } : { ...entry }
  ) ?? [];
}

/**
 * Returns the route entries of the decorated class for writing. Entries
 * inherited from a parent class are copied first, so decorating a subclass
 * never changes the routes of its parent or its siblings.
 *
 * @param {ClassDecoratorContext} ctx - Class decorator context.
 * @return {RequestMappingMetadata[]} The own, mutable route entries.
 */
export function getRequestMappingMetadata(
  ctx: ClassDecoratorContext,
): RequestMappingMetadata[];
/**
 * Returns the route entries of the class that declares the decorated method
 * for writing. Entries inherited from a parent class are copied first, so
 * decorating a subclass never changes the routes of its parent or its
 * siblings.
 *
 * @param {ClassMethodDecoratorContext<T, V>} ctx - Method decorator context.
 * @return {RequestMappingMetadata[]} The own, mutable route entries.
 */
export function getRequestMappingMetadata<
  T extends object,
  V extends ClassMethodDecoratorInitializer<T>,
>(
  ctx: ClassMethodDecoratorContext<T, V>,
): RequestMappingMetadata[];
/**
 * Reads the route entries of a class, including the ones inherited from its
 * parent classes. Never writes metadata.
 *
 * @param {Type} target - The controller class.
 * @return {RequestMappingMetadata[] | undefined} The route entries, or
 *   `undefined` when the class has none.
 */
export function getRequestMappingMetadata(
  target: Type,
): RequestMappingMetadata[] | undefined;
export function getRequestMappingMetadata(
  ctxOrTarget: ClassDecoratorContext | ClassMethodDecoratorContext | Type,
): RequestMappingMetadata[] | undefined {
  if ("kind" in ctxOrTarget) {
    return getOwnMetadata(
      ctxOrTarget.metadata,
      CONTROLLER_REQUEST_MAPPING,
      cloneRequestMapping,
    );
  }

  return ctxOrTarget[Symbol.metadata]?.[CONTROLLER_REQUEST_MAPPING] as
    | RequestMappingMetadata[]
    | undefined;
}

/**
 * Returns the route entry of the decorated method, creating it when the
 * method has none yet. The entry belongs to the class that declares the
 * method (see {@link getRequestMappingMetadata}).
 *
 * @param {ClassMethodDecoratorContext<T, V>} ctx - Method decorator context.
 * @return {RequestMappingMetadata} The mutable route entry of the method.
 */
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

/**
 * Creates a method decorator that updates the route entry of the decorated
 * method.
 *
 * @param {{ name: string; initializer: (entry: RequestMappingMetadata) => void }} decorator -
 *   Decorator name (used in error messages) and the function applied to the
 *   route entry.
 * @return {MethodDecorator} The method decorator. It throws when applied to a
 *   static or `#private` method.
 */
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
    assertInstanceMember(
      decorator.name,
      ctx as ClassMethodDecoratorContext,
      "function",
    );

    const entry = preserveRequestMappingMetadata(ctx);

    decorator.initializer(entry);

    return target;
  };
}
