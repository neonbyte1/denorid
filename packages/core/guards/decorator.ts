import {
  type ClassMethodDecoratorInitializer,
  type Decorator,
  InvalidStaticMemberDecoratorUsageError,
  type MethodDecorator,
  type Type,
} from "@denorid/injector";
import { CONTROLLER_REQUEST_MAPPING } from "../_constants.ts";
import { preserveRequestMappingMetadata } from "../http/_request_mapping.ts";
import type { CanActivate, CanActivateFn } from "./can_activate.ts";

export const GUARDS_METADATA = Symbol.for("denorid.guards");

/**
 * Returns the method-level guards registered on `type` for the given `methodName`.
 *
 * Guards applied via {@link UseGuards} on a method are stored alongside the HTTP
 * request-mapping entry for that method. This helper retrieves them without
 * requiring callers to know about the HTTP-internal metadata structure.
 *
 * @param {Type} type - The controller or handler class constructor.
 * @param {string | symbol} methodName - The method name to look up.
 * @returns {Set<Type<CanActivate> | CanActivate | CanActivateFn> | undefined}
 */
export function getMethodGuards(
  type: Type,
  methodName: string | symbol,
): Set<Type<CanActivate> | CanActivate | CanActivateFn> | undefined {
  const metadata = type[Symbol.metadata];

  if (metadata == null) {
    return undefined;
  }

  const requestMapping = metadata[CONTROLLER_REQUEST_MAPPING] as
    | Array<{ name: string | symbol; guards?: Set<unknown> }>
    | undefined;

  const entry = requestMapping?.find(({ name }) => name === methodName);

  return entry?.guards as
    | Set<Type<CanActivate> | CanActivate | CanActivateFn>
    | undefined;
}

/**
 * Decorator that binds one or more guards to a controller class or a single
 * route handler method.
 *
 * Guards are evaluated in the order they are provided. If any guard returns
 * `false` (or a `Promise` that resolves to `false`), the request is denied
 * and subsequent guards are not evaluated.
 *
 * Accepts three forms of guards:
 * - A class type implementing {@link CanActivate} (resolved via the DI container)
 * - An already-instantiated {@link CanActivate} object
 * - A plain {@link CanActivateFn} function
 *
 * @example
 * ```ts
 * @UseGuards(AuthGuard)
 * @Controller('/protected')
 * class ProtectedController {}
 *
 * // Applied to a single route handler
 * @Controller('/items')
 * class ItemsController {
 *   @UseGuards(RolesGuard)
 *   @Get('/:id')
 *   getItem(): string { return 'item'; }
 * }
 * ```
 *
 * @param {...(Type<CanActivate> | CanActivate | CanActivateFn)} guards One or
 * more guards to bind. Each guard can be a class type, an instance, or a
 * plain function.
 *
 * @returns {Decorator<ClassDecoratorContext, Type> & MethodDecorator} A
 * decorator applicable to both classes and non-static methods.
 */
export function UseGuards(
  ...guards: (Type<CanActivate> | CanActivate | CanActivateFn)[]
): Decorator<ClassDecoratorContext, Type> & MethodDecorator {
  const decorator = function <
    T extends object,
    V extends ClassMethodDecoratorInitializer<T>,
  >(
    target: V,
    ctx: ClassDecoratorContext | ClassMethodDecoratorContext<T, V>,
  ): V {
    let cache: Set<Type<CanActivate> | CanActivate | CanActivateFn>;

    if (ctx.kind === "method") {
      if (ctx.static) {
        throw new InvalidStaticMemberDecoratorUsageError(
          UseGuards.name,
          ctx.name,
          "function",
        );
      }

      cache = preserveRequestMappingMetadata(ctx).guards ??= new Set();
    } else {
      cache = (ctx.metadata[GUARDS_METADATA] ??= new Set()) as Set<
        Type<CanActivate> | CanActivate | CanActivateFn
      >;
    }

    for (const guard of guards) {
      cache.add(guard);
    }

    return target;
  };

  return decorator as Decorator<ClassDecoratorContext, Type> & MethodDecorator;
}
