import type { Type } from "@denorid/injector";
import type {
  ApiOperationOptions,
  ApiResponseOptions,
  ApiResponseStatus,
} from "./decorators.ts";
import type { SecurityRequirementObject } from "./types.ts";

/** Documentation set on a class (every route of a controller) or a route. */
export interface ApiMetadata {
  /** Tags added by `@ApiTags()`. */
  tags: string[];
  /** Responses added by `@ApiResponse()`, by status. */
  responses: Map<ApiResponseStatus, ApiResponseOptions>;
  /**
   * One entry per `@ApiSecurity()` with requirements: the alternatives
   * accepted by it.
   */
  security: SecurityRequirementObject[][];
  /** Set by `@ApiSecurity()` without requirements. */
  public: boolean;
  /** Set by `@ApiExclude()`. */
  exclude: boolean;
}

/** Documentation set on a controller method. */
export interface ApiRouteMetadata extends ApiMetadata {
  /** Fields set by `@ApiOperation()`. */
  operation: ApiOperationOptions;
}

/** Class-level documentation, stored in the class metadata. */
const CLASS_METADATA = Symbol.for("denorid.openapi.class");

/** Route documentation by method name, stored in the class metadata. */
const ROUTE_METADATA = Symbol.for("denorid.openapi.routes");

/**
 * Copies documentation so a subclass can change it without touching its
 * parent.
 *
 * @param {ApiMetadata | undefined} metadata - Documentation to copy.
 * @return {ApiMetadata} The copy, or empty documentation.
 */
function cloneMetadata(metadata: ApiMetadata | undefined): ApiMetadata {
  return {
    tags: [...metadata?.tags ?? []],
    responses: new Map(metadata?.responses),
    security: [...metadata?.security ?? []],
    public: metadata?.public ?? false,
    exclude: metadata?.exclude ?? false,
  };
}

/**
 * Returns the class-level documentation of the decorated class for writing.
 * Documentation inherited from a parent class is copied first.
 *
 * @param {DecoratorMetadataObject} metadata - `ctx.metadata` of the decorator.
 * @return {ApiMetadata} The own, mutable documentation.
 */
export function ownClassMetadata(
  metadata: DecoratorMetadataObject,
): ApiMetadata {
  if (!Object.hasOwn(metadata, CLASS_METADATA)) {
    metadata[CLASS_METADATA] = cloneMetadata(
      metadata[CLASS_METADATA] as ApiMetadata | undefined,
    );
  }

  return metadata[CLASS_METADATA] as ApiMetadata;
}

/**
 * Returns the documentation of a method of the decorated class for writing.
 * Documentation inherited from a parent class is copied first.
 *
 * @param {DecoratorMetadataObject} metadata - `ctx.metadata` of the decorator.
 * @param {string | symbol} name - Name of the method.
 * @return {ApiRouteMetadata} The own, mutable documentation of the method.
 */
export function ownRouteMetadata(
  metadata: DecoratorMetadataObject,
  name: string | symbol,
): ApiRouteMetadata {
  if (!Object.hasOwn(metadata, ROUTE_METADATA)) {
    const inherited = metadata[ROUTE_METADATA] as
      | Map<string | symbol, ApiRouteMetadata>
      | undefined;

    metadata[ROUTE_METADATA] = new Map(
      [...inherited ?? []].map(([key, value]) => [key, {
        ...cloneMetadata(value),
        operation: { ...value.operation },
      }]),
    );
  }

  const routes = metadata[ROUTE_METADATA] as Map<
    string | symbol,
    ApiRouteMetadata
  >;
  let route = routes.get(name);

  if (route === undefined) {
    route = { ...cloneMetadata(undefined), operation: {} };

    routes.set(name, route);
  }

  return route;
}

/**
 * Reads the class-level documentation of a class, including the one
 * inherited from its parent classes.
 *
 * @param {{ readonly [Symbol.metadata]?: DecoratorMetadataObject | null }} target -
 *   A class, or a function (e.g. a guard function), which has none.
 * @return {ApiMetadata | undefined} The documentation, `undefined` when the
 *   class has none.
 */
export function readClassMetadata(
  target: { readonly [Symbol.metadata]?: DecoratorMetadataObject | null },
): ApiMetadata | undefined {
  return target[Symbol.metadata]?.[CLASS_METADATA] as ApiMetadata | undefined;
}

/**
 * Reads the documentation of a controller method, including the one
 * inherited from parent classes.
 *
 * @param {Type} target - The controller class.
 * @param {string | symbol} name - Name of the method.
 * @return {ApiRouteMetadata | undefined} The documentation, `undefined` when
 *   the method has none.
 */
export function readRouteMetadata(
  target: Type,
  name: string | symbol,
): ApiRouteMetadata | undefined {
  return (target[Symbol.metadata]?.[ROUTE_METADATA] as
    | Map<string | symbol, ApiRouteMetadata>
    | undefined)?.get(name);
}
