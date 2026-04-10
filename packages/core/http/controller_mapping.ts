import type { InjectorContext, Type } from "@denorid/injector";
import { Logger, type LoggerService } from "@denorid/logger";
import {
  CONTROLLER_METADATA,
  CONTROLLER_REQUEST_MAPPING,
  HTTP_CONTROLLER_METADATA,
} from "../_constants.ts";
import type { ExceptionHandler } from "../exceptions/handler.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import { GUARDS_METADATA } from "../guards/decorator.ts";
import type { ExecutionContext } from "../guards/execution_context.ts";
import { isClass, isFunction } from "../type_guards.ts";
import type { RequestMappingMetadata } from "./_request_mapping.ts";
import type { ControllerOptions } from "./controller_options.ts";
import type { RequestContext } from "./request_context.ts";

/** A route handler function that receives a request context and returns a response. */
export type HttpRouteFn = (ctx: RequestContext) => Promise<unknown> | unknown;

/** A controller instance represented as a map of route handler functions. */
export type HttpController = Record<PropertyKey, HttpRouteFn>;

/**
 * Base class for HTTP adapter-specific controller mappings.
 *
 * Iterates over all controllers registered in the injector context and
 * delegates the actual route registration to the adapter implementation
 * via {@link registerRoute}.
 */
export abstract class ControllerMapping {
  protected readonly logger: LoggerService = new Logger(
    ControllerMapping.name,
    {
      timestamp: true,
    },
  );

  /**
   * @param {InjectorContext} ctx - The injector context used to resolve controllers.
   * @param {ExceptionHandler} exceptionHandler - Handler invoked when a route throws.
   * @param {CanActivate|CanActivateFn} globalGuards - Array of global guard instances or function.
   */
  public constructor(
    protected readonly ctx: InjectorContext,
    protected readonly exceptionHandler: ExceptionHandler,
    protected readonly globalGuards: (CanActivate | CanActivateFn)[],
  ) {}

  /**
   * Registers all HTTP controllers found in the injector context.
   *
   * @param {string} [basePath] - Optional path prefix applied to every controller.
   * @return {Promise<void>} Resolves when all controllers have been registered.
   */
  public async register(basePath?: string): Promise<void> {
    basePath ??= "";

    for (
      const token of this.ctx.container
        .getTokensByTag(HTTP_CONTROLLER_METADATA)
    ) {
      await this.registerController(token as Type<HttpController>, basePath);
    }
  }

  /**
   * Registers a single route with the underlying HTTP engine.
   *
   * Implemented by each adapter to bind the route metadata to its own
   * routing mechanism (e.g. Hono, Oak, etc.).
   *
   * @param {Type<HttpController>} controllerClass - The controller class owning the route.
   * @param {string} controllerBasePath - The fully-resolved base path for the controller.
   * @param {RequestMappingMetadata} route - Metadata describing the route (method, path, handler).
   * @param {(Type<CanActivate>|CanActivate|CanActivateFn)[]} controllerGuards - Guards defined on
   * the controller level. Each guard is either a class reference (resolved via DI), an
   * already-instantiated object, or a plain function. All guards must return `true`
   * for the request to proceed.
   * @return {Promise<void>} Resolves when the route has been registered.
   */
  protected abstract registerRoute(
    controllerClass: Type<HttpController>,
    controllerBasePath: string,
    controllerGuards: (Type<CanActivate> | CanActivate | CanActivateFn)[],
    route: RequestMappingMetadata,
  ): Promise<void>;

  /**
   * Reads controller metadata and registers each of its declared routes.
   *
   * @param {Type<HttpController>} controllerClass - The controller class to register.
   * @param {string} basePath - The global path prefix to prepend.
   * @return {Promise<void>} Resolves when all routes of the controller are registered.
   */
  protected async registerController(
    controllerClass: Type<HttpController>,
    basePath: string,
  ): Promise<void> {
    const options = controllerClass[Symbol.metadata]
      ?.[CONTROLLER_METADATA] as ControllerOptions;

    const controllerBasePath = this.joinPaths(
      basePath,
      ...this.normalizePaths(options.path),
    );

    const requestMapping =
      (controllerClass[Symbol.metadata]?.[CONTROLLER_REQUEST_MAPPING] ??
        []) as RequestMappingMetadata[];

    const controllerGuards = controllerClass[Symbol.metadata]
      ?.[GUARDS_METADATA] as
        | Set<Type<CanActivate> | CanActivate | CanActivateFn>
        | undefined;

    for (const route of requestMapping) {
      await this.registerRoute(
        controllerClass,
        controllerBasePath,
        controllerGuards ? [...controllerGuards] : [],
        route,
      );
    }
  }

  protected async resolveGuards(
    executionContext: ExecutionContext,
    ...guards: (Type<CanActivate> | CanActivate | CanActivateFn)[]
  ): Promise<boolean> {
    for (const guard of guards) {
      if (!(await this.resolveGuard(executionContext, guard))) {
        return false;
      }
    }

    return true;
  }

  protected async resolveGuard(
    executionContext: ExecutionContext,
    guard: Type<CanActivate> | CanActivate | CanActivateFn,
  ): Promise<boolean> {
    if (isClass<CanActivate>(guard)) {
      return await (await this.ctx.resolve(guard)).canActivate(
        executionContext,
      );
    }
    if (isFunction<CanActivateFn>(guard)) {
      return await guard(executionContext);
    }

    return await guard.canActivate(executionContext);
  }

  /**
   * Normalizes a path value to an array of path strings.
   *
   * @param {string | string[] | undefined} path - The raw path value from controller metadata.
   * @return {string[]} An array of path strings, or an empty array if undefined.
   */
  protected normalizePaths(path: string | string[] | undefined): string[] {
    return path !== undefined ? Array.isArray(path) ? path : [path] : [];
  }

  /**
   * Joins multiple path segments into a single normalized path.
   *
   * Leading and trailing slashes are stripped from each segment before
   * joining, and a single leading slash is added to the result.
   *
   * @param {...string} parts - The path segments to join.
   * @return {string} The normalized combined path (e.g. `"/foo/bar"`).
   */
  protected joinPaths(...parts: string[]): string {
    return `/${
      parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")
    }`;
  }
}
