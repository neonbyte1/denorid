import {
  type CanActivate,
  type CanActivateFn,
  ControllerMapping,
  type ControllerMappingOptions,
  type CorsOptions,
  ForbiddenException,
  type HostArguments,
  type HttpController,
  HttpException,
  HttpMethod,
  type HttpRoute,
  InternalServerErrorException,
  type RequestMappingMetadata,
  StatusCode,
  UnprocessableContentException,
} from "@denorid/core";
import type { Type } from "@denorid/injector";
import type { Context, Hono, MiddlewareHandler } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { createClientIpResolver } from "./_client_ip.ts";
import { createStaticFilesHandler } from "./_static_files.ts";
import type { HonoAdapterOptions } from "./adapter.ts";
import { HonoExecutionContext } from "./execution_context.ts";
import { HonoHostArguments } from "./host_arguments.ts";
import { HonoRequestContext } from "./request_context.ts";

/** Guard accepted on the global, controller and route level. */
type Guard = Type<CanActivate> | CanActivate | CanActivateFn;

/** A handler collected by `registerRoute`, added to the Hono app by `register`. */
interface HonoRoute {
  /** Method the handler is registered for on the Hono app. */
  method: string;
  /** Full path of the route. */
  path: string;
  /** The handler. */
  handler: MiddlewareHandler;
  /** Whether the handler serves an explicit `@Head()` route. */
  head: boolean;
}

/**
 * Creates the Hono CORS middleware for the CORS option of the application.
 *
 * Options that are not set are left out, since Hono spreads the given options
 * over its defaults (an `undefined` `allowMethods` would answer preflights
 * without any allowed method).
 *
 * @param {boolean | CorsOptions | undefined} options - The CORS option.
 * @return {MiddlewareHandler | undefined} The middleware, `undefined` when
 *   CORS is disabled.
 */
function createCorsMiddleware(
  options: boolean | CorsOptions | undefined,
): MiddlewareHandler | undefined {
  if (options === true) {
    return cors();
  }

  if (!options) {
    return undefined;
  }

  const {
    origin,
    allowMethods,
    allowHeaders,
    maxAge,
    credentials,
    exposeHeaders,
  } = options;

  return cors({
    origin,
    ...(allowMethods === undefined ? {} : {
      allowMethods: allowMethods.map((method) =>
        typeof method === "string" ? method : HttpMethod[method]
      ),
    }),
    ...(allowHeaders === undefined ? {} : { allowHeaders }),
    ...(maxAge === undefined ? {} : { maxAge }),
    ...(credentials === undefined ? {} : { credentials }),
    ...(exposeHeaders === undefined ? {} : { exposeHeaders }),
  });
}

/**
 * {@linkcode ControllerMapping} registering the routes of every controller on
 * a Hono app.
 *
 * - Every entry of a route path array is registered as its own route.
 * - Controllers with a `host` option only serve matching hosts; requests for
 *   other hosts are passed on to the next route, the static files or the 404.
 * - `@Head()` routes take precedence over `GET` routes on the same path, which
 *   Hono uses for `HEAD` requests otherwise.
 * - With CORS enabled, preflight (`OPTIONS`) requests on route paths are
 *   answered by the CORS middleware.
 * - Every request gets a fresh DI context id (`crypto.randomUUID()`).
 */
export class HonoControllerMapping extends ControllerMapping {
  private readonly resolveIp: (ctx: Context) => string;
  private readonly cors?: MiddlewareHandler;
  private readonly routes: HonoRoute[] = [];

  /**
   * @param {Hono} app - Hono app every route is registered on.
   * @param {ControllerMappingOptions} options - Configuration for the controller mapping.
   * @param {HonoAdapterOptions} [adapterOptions] - Static files and client address resolution.
   * @throws {RangeError} When `adapterOptions.clientIp.trustProxy` is an invalid hop count.
   * @throws {TypeError} When `adapterOptions.clientIp` lists an invalid proxy or header.
   */
  public constructor(
    private readonly app: Hono,
    options: ControllerMappingOptions,
    private readonly adapterOptions: HonoAdapterOptions = {},
  ) {
    super(options);

    this.resolveIp = createClientIpResolver(adapterOptions.clientIp);
    this.cors = createCorsMiddleware(options.cors);
  }

  /**
   * Registers all HTTP controllers, followed by the static files handler when
   * configured, so controller routes always take precedence over files.
   *
   * The routes are added to the Hono app once all controllers are read:
   * explicit `@Head()` routes first, since Hono answers `HEAD` requests with
   * the `GET` routes, then all other routes in declaration order.
   *
   * @param {string} [basePath] - Optional path prefix applied to every
   * controller; never served from the static files root.
   * @return {Promise<readonly HttpRoute[]>} The registered controller routes
   *   (see {@linkcode ControllerMapping.register}); the static files handler
   *   is no route.
   * @throws {Error} When the static files root or fallback does not exist.
   */
  public override async register(
    basePath?: string,
  ): Promise<readonly HttpRoute[]> {
    const registered = await super.register(basePath);

    const routes = this.routes.splice(0);

    for (const route of routes.filter(({ head }) => head)) {
      this.app.on(route.method, route.path, route.handler);
    }

    for (const route of routes.filter(({ head }) => !head)) {
      this.app.on(route.method, route.path, route.handler);
    }

    const staticFiles = this.adapterOptions.staticFiles;

    if (staticFiles !== undefined) {
      this.app.get(
        "*",
        await createStaticFilesHandler(
          staticFiles,
          this.joinPaths(basePath ?? ""),
        ),
      );

      this.logger.log(
        `Mapped {/*, GET} to static files in ${staticFiles.root}`,
      );
    }

    return registered;
  }

  /**
   * Collects the handlers of a route, one per entry of the route path, which
   * {@linkcode register} adds to the Hono app. `@Head()` routes are
   * registered as `GET` routes answering `HEAD` requests only. With CORS
   * enabled, an `OPTIONS` handler per path answers preflight requests.
   *
   * @inheritdoc
   */
  // deno-lint-ignore require-await
  protected override async registerRoute(
    controllerClass: Type<HttpController>,
    controllerBasePath: string,
    controllerGuards: Guard[],
    route: RequestMappingMetadata,
  ): Promise<void> {
    // Core only registers route entries that have an HTTP method.
    const methodName = HttpMethod[route.method as HttpMethod];
    const head = route.method === HttpMethod.HEAD;
    const guards = [
      ...new Set([
        ...this.options.globalGuards,
        ...controllerGuards,
        ...(route.guards ?? []),
      ]),
    ];
    const corsMiddleware = this.cors;

    const handler: MiddlewareHandler = async (c, next) => {
      if (
        (head && c.req.method !== "HEAD") ||
        !this.matchesHost(controllerClass, new URL(c.req.url).hostname)
      ) {
        return await next();
      }

      if (corsMiddleware === undefined) {
        return await this.handle(c, controllerClass, guards, route);
      }

      return await corsMiddleware(c, async () => {
        c.res = await this.handle(c, controllerClass, guards, route);
      }) ?? c.res;
    };
    const preflight: MiddlewareHandler | undefined =
      corsMiddleware === undefined
        ? undefined
        : async (c, next) =>
          this.matchesHost(controllerClass, new URL(c.req.url).hostname)
            ? await corsMiddleware(c, next)
            : await next();

    const paths = this.normalizePaths(route.path);

    for (const path of paths.length > 0 ? paths : [""]) {
      const fullPath = this.joinPaths(controllerBasePath, path);

      this.routes.push({
        method: head ? "GET" : methodName,
        path: fullPath,
        handler,
        head,
      });

      if (preflight !== undefined) {
        this.routes.push({
          method: "OPTIONS",
          path: fullPath,
          handler: preflight,
          head: false,
        });
      }

      this.logger.log(`Mapped {${fullPath}, ${methodName}} route`);
    }
  }

  /**
   * Runs a request through guards, input validation and the controller
   * method, inside a request scope with a fresh DI context id. The validated
   * inputs are also added to the Hono request, for `c.req.valid()`.
   *
   * @param {Context} c - The Hono context of the request.
   * @param {Type<HttpController>} controllerClass - The controller class owning the route.
   * @param {Guard[]} guards - Global, controller and route guards, in order.
   * @param {RequestMappingMetadata} route - The route.
   * @return {Promise<Response>} The response.
   */
  private async handle(
    c: Context,
    controllerClass: Type<HttpController>,
    guards: Guard[],
    route: RequestMappingMetadata,
  ): Promise<Response> {
    // Never taken from the request: transient instances are cached per id.
    const contextId = crypto.randomUUID();

    return await this.options.ctx.runInRequestScopeAsync(
      contextId,
      async () => {
        const context = new HonoRequestContext<unknown>(
          c,
          contextId,
          undefined,
          this.resolveIp,
        );
        const hostArguments = new HonoHostArguments(c, context);

        try {
          const controller = await this.options.ctx.getHostModuleRef().get<
            HttpController
          >(controllerClass, { contextId, strict: false });

          const executionContext = new HonoExecutionContext(
            c,
            context,
            controllerClass,
            controller[route.name],
          );

          if (!await this.resolveGuards(executionContext, ...guards)) {
            throw new ForbiddenException();
          }

          await this.validateRequest(
            context,
            route,
            (type) => type === "json" ? c.req.json() : c.req.parseBody(),
          );
          this.addValidatedData(c, context, route);

          const res = await controller[route.name](context);

          return this.resolveResponse(c, res, route.statusCode);
        } catch (err) {
          return await this.handleError(c, hostArguments, err);
          // I haven't found a solution to catch the finally :(
          // deno-coverage-ignore-start
        } finally {
          this.options.ctx.clearContext(contextId);
        }
        // deno-coverage-ignore-stop
      },
    );
  }

  /**
   * Adds the validated inputs of a request to the Hono request: the body as
   * `json` or `form`, the query string as `query`, the path parameters as
   * `param` and the headers as `header`.
   *
   * @param {Context} c - The Hono context of the request.
   * @param {HonoRequestContext<unknown>} context - The validated request context.
   * @param {RequestMappingMetadata} route - The route.
   */
  private addValidatedData(
    c: Context,
    context: HonoRequestContext<unknown>,
    route: RequestMappingMetadata,
  ): void {
    if (route.validation !== undefined) {
      c.req.addValidatedData(
        route.validation.type,
        context.dto as Record<string, unknown>,
      );
    }

    if (route.query !== undefined) {
      c.req.addValidatedData(
        "query",
        context.validated(route.query) as Record<string, unknown>,
      );
    }

    if (route.params !== undefined) {
      c.req.addValidatedData(
        "param",
        context.validated(route.params) as Record<string, unknown>,
      );
    }

    if (route.headers !== undefined) {
      c.req.addValidatedData(
        "header",
        context.validated(route.headers) as Record<string, unknown>,
      );
    }
  }

  /**
   * Serializes the result of a controller method (see {@linkcode serialize}).
   * `undefined` and `null` answer with an empty body and the route's status
   * code, `204` without one.
   *
   * @param {Context} c - The Hono context of the request.
   * @param {unknown} res - The result of the controller method.
   * @param {StatusCode | undefined} statusCode - Status code set by `@HttpCode()`.
   * @return {Response} The response.
   * @throws {UnprocessableContentException} When the result cannot be serialized.
   */
  private resolveResponse(
    c: Context,
    res: unknown,
    statusCode: StatusCode | undefined,
  ): Response {
    if (res === undefined || res === null) {
      return c.body(null, (statusCode ?? StatusCode.NoContent) as 204);
    }

    const response = this.serialize(c, res, statusCode ?? StatusCode.Ok);

    if (response === undefined) {
      throw new UnprocessableContentException();
    }

    return response;
  }

  /**
   * Answers a failed request.
   *
   * Without exception filter result, an `HttpException` is sent with its
   * body and status and any other error as the standard
   * `InternalServerErrorException` body; the internal message never reaches
   * the client. Filter results are normalized:
   *
   * - A `Response` is sent as is.
   * - An array (several filters returned a value) is replaced by its first
   *   `Response`; without one the array is serialized like any other value.
   * - An `HttpException` is sent with its body and status.
   * - Other values are serialized like controller results (see
   *   {@linkcode serialize}) with the status of the handled error (`500`
   *   unless it is an `HttpException`). Values that cannot be serialized fall
   *   back to the default answer.
   *
   * @param {Context} c - The Hono context of the request.
   * @param {HostArguments} hostArguments - Passed to the exception filters.
   * @param {unknown} err - The thrown value.
   * @return {Promise<Response>} The response.
   */
  private async handleError(
    c: Context,
    hostArguments: HostArguments,
    err: unknown,
  ): Promise<Response> {
    if (!(err instanceof Error)) {
      // The exception handler only logs errors, and the value is not sent.
      this.logger.error(err);
    }

    const result = await this.options.exceptionHandler.handle(
      err,
      hostArguments,
    );
    const filtered = Array.isArray(result)
      ? result.find((value) => value instanceof Response) ?? result
      : result;
    const exception = filtered instanceof HttpException
      ? filtered
      : err instanceof HttpException
      ? err
      : new InternalServerErrorException();
    const response = filtered === undefined || filtered === exception
      ? undefined
      : this.serialize(c, filtered, exception.status);

    return response ?? c.json(exception.response, exception.status as 500);
  }

  /**
   * Turns a value into a response: a `Response` is returned as is, strings,
   * numbers, booleans, bigints and symbols are sent as text, other objects
   * (including arrays and `null`) as JSON.
   *
   * @param {Context} c - The Hono context of the request.
   * @param {unknown} value - The value to send.
   * @param {number} status - Status code of the response.
   * @return {Response | undefined} The response, `undefined` for values that
   *   cannot be serialized (functions and `undefined`).
   */
  private serialize(
    c: Context,
    value: unknown,
    status: number,
  ): Response | undefined {
    if (value instanceof Response) {
      return value;
    }

    switch (typeof value) {
      case "string":
      case "number":
      case "symbol":
      case "bigint":
      case "boolean":
        return c.text(String(value), status as 200);
      case "object":
        return c.json(value, status as 200);
    }

    return undefined;
  }
}
