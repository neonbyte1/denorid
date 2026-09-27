import type { Type } from "@denorid/injector";
import { Logger, type LoggerService } from "@denorid/logger";
import type { ZodType } from "zod";
import {
  CONTROLLER_METADATA,
  CONTROLLER_REQUEST_MAPPING,
  HTTP_CONTROLLER_METADATA,
} from "../_constants.ts";
import { BadRequestException } from "../exceptions/http/bad_request.ts";
import { ZodValidationException } from "../exceptions/http/zod_validation.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import { GUARDS_METADATA } from "../guards/decorator.ts";
import type { ExecutionContext } from "../guards/execution_context.ts";
import { isClass, isFunction } from "../type_guards.ts";
import { createQueryInput } from "./_query_input.ts";
import type { RequestMappingMetadata } from "./_request_mapping.ts";
import { VALIDATED_INPUTS } from "./_validated.ts";
import type { ControllerMappingOptions } from "./adapter.ts";
import type { ControllerOptions } from "./controller_options.ts";
import type { RequestContext } from "./request_context.ts";

/**
 * Splits a host into hostname and optional `:port`: `example.com:8080` and
 * `[::1]:8080` yield `example.com` and `[::1]`. A bare IPv6 address such as
 * `::1` does not match and is used as is.
 */
const HOST_WITHOUT_PORT = /^(\[[^\]]*\]|[^:]*)(?::\d*)?$/;

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
   * @param {ControllerMappingOptions} options - Configuration for the controller mapping,
   *   including the injector context, exception handler, CORS settings, and global guards.
   */
  public constructor(
    protected readonly options: ControllerMappingOptions,
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
      const token of this.options.ctx.container
        .getTokensByTag(HTTP_CONTROLLER_METADATA, true)
    ) {
      await this.registerController(token as Type<HttpController>, basePath);
    }
  }

  /**
   * Registers a single route with the underlying HTTP engine.
   *
   * Implemented by each adapter to bind the route metadata to its own
   * routing mechanism (e.g. Hono, Oak, etc.). It is called once per
   * controller base path, and only for entries that have an HTTP `method`.
   * The entries of an array `route.path` are alternatives: register the
   * handler once per entry of `normalizePaths(route.path)`. Before running
   * guards, check {@link matchesHost} for every request and pass requests
   * for other hosts on. After the guards, call {@link validateRequest}
   * before the controller method.
   *
   * @param {Type<HttpController>} controllerClass - The controller class owning the route.
   * @param {string} controllerBasePath - The fully-resolved base path for the controller.
   * @param {(Type<CanActivate>|CanActivate|CanActivateFn)[]} controllerGuards - Guards defined on
   * the controller level. Each guard is either a class reference (resolved via DI), an
   * already-instantiated object, or a plain function. All guards must return `true`
   * for the request to proceed.
   * @param {RequestMappingMetadata} route - Metadata describing the route (method, path, handler).
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
   * Every entry of the controller path is an alternative base path: the
   * routes are registered once per entry (a missing path counts as one empty
   * path). Route entries without an HTTP method (only `@HttpCode()`,
   * `@Body()`, `@Form()`, `@Query()`, `@Params()` or `@UseGuards()` on a
   * method) are not routes and are skipped.
   *
   * @param {Type<HttpController>} controllerClass - The controller class to register.
   * @param {string} basePath - The global path prefix to prepend.
   * @return {Promise<void>} Resolves when all routes of the controller are registered.
   */
  protected async registerController(
    controllerClass: Type<HttpController>,
    basePath: string,
  ): Promise<void> {
    const metadata = controllerClass[Symbol.metadata];
    const options = metadata?.[CONTROLLER_METADATA] as ControllerOptions;
    const controllerPaths = this.normalizePaths(options.path);

    const routes = (
      (metadata?.[CONTROLLER_REQUEST_MAPPING] ?? []) as RequestMappingMetadata[]
    ).filter((route) => route.method !== undefined);

    const controllerGuards = metadata?.[GUARDS_METADATA] as
      | Set<Type<CanActivate> | CanActivate | CanActivateFn>
      | undefined;

    for (
      const controllerPath of controllerPaths.length > 0
        ? controllerPaths
        : [""]
    ) {
      const controllerBasePath = this.joinPaths(basePath, controllerPath);

      for (const route of routes) {
        await this.registerRoute(
          controllerClass,
          controllerBasePath,
          controllerGuards ? [...controllerGuards] : [],
          route,
        );
      }
    }
  }

  /**
   * Validates the inputs of a request against the schemas declared on the
   * route, in this order: the path parameters (`@Params()`), the query
   * string (`@Query()`, see the `@Query()` decorator for the array rule) and
   * the body (`@Body()` or `@Form()`). Parts without schema are skipped; the
   * body is only read when the route declares a body schema.
   *
   * Every parsed value is available through `context.validated(schema)`;
   * the parsed body is also assigned to `context.dto`. Adapters call it
   * after the guards allowed the request and before the controller method.
   *
   * @param {RequestContext} context - The context of the request.
   * @param {RequestMappingMetadata} route - The route of the request.
   * @param {(type: "json" | "form") => Promise<unknown>} readBody - Reads the
   *   body as JSON or as form data.
   * @return {Promise<void>} Resolves when every declared input is valid.
   * @throws {BadRequestException} When the body cannot be read.
   * @throws {ZodValidationException} When an input fails its schema.
   */
  protected async validateRequest(
    context: RequestContext,
    route: RequestMappingMetadata,
    readBody: (type: "json" | "form") => Promise<unknown>,
  ): Promise<void> {
    if (route.params !== undefined) {
      await this.parseInput(context, route.params, context.params());
    }

    if (route.query !== undefined) {
      await this.parseInput(
        context,
        route.query,
        createQueryInput(route.query, context.queries()),
      );
    }

    if (route.validation === undefined) {
      return;
    }

    const { type, dto } = route.validation;
    let body: unknown;

    try {
      body = await readBody(type);
    } catch {
      throw new BadRequestException("Malformed request body");
    }

    context.dto = await this.parseInput(context, dto, body);
  }

  /**
   * Parses one input of a request and stores the result for
   * `context.validated(schema)`.
   *
   * @param {RequestContext} context - The context of the request.
   * @param {ZodType} schema - The schema declared on the route.
   * @param {unknown} input - The raw input.
   * @return {Promise<unknown>} The parsed value.
   * @throws {ZodValidationException} When the input fails the schema.
   */
  private async parseInput(
    context: RequestContext,
    schema: ZodType,
    input: unknown,
  ): Promise<unknown> {
    const result = await schema.safeParseAsync(input);

    if (!result.success) {
      throw new ZodValidationException(result.error);
    }

    let values = VALIDATED_INPUTS.get(context);

    if (values === undefined) {
      values = new Map();
      VALIDATED_INPUTS.set(context, values);
    }

    values.set(schema, result.data);

    return result.data;
  }

  /**
   * Checks the `host` option of the controller against the host of a
   * request. Adapters call it for every request before running guards and
   * pass the request on (so other routes, static files or the 404 handler
   * apply) when it returns `false`.
   *
   * - No `host` option: every host matches.
   * - String entries match the hostname case-insensitively.
   * - RegExp entries are tested against the hostname.
   * - An array matches when any entry matches.
   *
   * @param {Type<HttpController>} controllerClass - The controller class owning the route.
   * @param {string} hostname - Hostname of the request (e.g. `URL.hostname`).
   *   A trailing `:port` (as in a `Host` header) is ignored.
   * @return {boolean} `true` when the controller's routes serve this host.
   */
  protected matchesHost(
    controllerClass: Type<HttpController>,
    hostname: string,
  ): boolean {
    const host = (controllerClass[Symbol.metadata]?.[CONTROLLER_METADATA] as
      | ControllerOptions
      | undefined)?.host;

    if (host === undefined) {
      return true;
    }

    const name = HOST_WITHOUT_PORT.exec(hostname)?.[1] ?? hostname;
    const lowerCaseName = name.toLowerCase();

    return (Array.isArray(host) ? host : [host]).some((pattern) => {
      if (typeof pattern === "string") {
        return pattern.toLowerCase() === lowerCaseName;
      }

      // A global or sticky RegExp keeps `lastIndex` between calls.
      pattern.lastIndex = 0;

      return pattern.test(name);
    });
  }

  /**
   * Evaluates guards in order and stops at the first one that denies.
   *
   * @param {ExecutionContext} executionContext - Context passed to every guard.
   * @param {...(Type<CanActivate> | CanActivate | CanActivateFn)} guards - The guards to evaluate.
   * @return {Promise<boolean>} `true` when every guard allows the request.
   */
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

  /**
   * Evaluates a single guard. A guard class is resolved through the injector
   * in the request's context, from whichever module declares it; an instance
   * is asked via `canActivate`; a function is called.
   *
   * @param {ExecutionContext} executionContext - Context passed to the guard.
   * @param {Type<CanActivate> | CanActivate | CanActivateFn} guard - The guard to evaluate.
   * @return {Promise<boolean>} `true` when the guard allows the request.
   */
  protected async resolveGuard(
    executionContext: ExecutionContext,
    guard: Type<CanActivate> | CanActivate | CanActivateFn,
  ): Promise<boolean> {
    if (isClass<CanActivate>(guard)) {
      return await (await this.options.ctx.getHostModuleRef().get(guard, {
        contextId: executionContext
          .switchToHttp()
          .getRequest()
          .contextId,
        strict: false,
      })).canActivate(
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
