import {
  BadRequestException,
  type CanActivate,
  type CanActivateFn,
  ControllerMapping,
  type ControllerMappingOptions,
  ForbiddenException,
  type HostArguments,
  type HttpController,
  HttpException,
  HttpMethod,
  InternalServerErrorException,
  type RequestMappingMetadata,
  StatusCode,
  UnprocessableContentException,
  ZodValidationException,
} from "@denorid/core";
import type { Type } from "@denorid/injector";
import type { Context, Hono, MiddlewareHandler } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import type { ZodType } from "zod";
import { HonoExecutionContext } from "./execution_context.ts";
import { HonoHostArguments } from "./host_arguments.ts";
import { HonoRequestContext } from "./request_context.ts";

cors();

export class HonoControllerMapping extends ControllerMapping {
  public constructor(
    private readonly app: Hono,
    options: ControllerMappingOptions,
  ) {
    super(options);
  }

  /**
   * @inheritdoc
   */
  // deno-lint-ignore require-await
  protected override async registerRoute(
    controllerClass: Type<HttpController>,
    controllerBasePath: string,
    controllerGuards: (Type<CanActivate> | CanActivate | CanActivateFn)[],
    route: RequestMappingMetadata,
  ): Promise<void> {
    const fullPath = this.joinPaths(
      controllerBasePath,
      ...this.normalizePaths(route.path),
    );

    const methodName = HttpMethod[route.method ?? HttpMethod.GET];
    const guards = [
      ...new Set([
        ...this.options.globalGuards,
        ...controllerGuards,
        ...(route.guards ?? []),
      ]),
    ];

    const middleware: MiddlewareHandler = async (c) => {
      const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();

      return await this.options.ctx.runInRequestScopeAsync(
        requestId,
        async () => {
          const context = new HonoRequestContext<unknown>(c, requestId, null);
          const hostArguments = new HonoHostArguments(c, context);

          try {
            const controller = await this.options.ctx.getHostModuleRef().get<
              HttpController
            >(controllerClass, { contextId: requestId, strict: false });

            const executionContext = new HonoExecutionContext(
              c,
              context,
              controllerClass,
              controller[route.name],
            );

            if (!await this.resolveGuards(executionContext, ...guards)) {
              throw new ForbiddenException();
            }

            context.dto = await this.validateRequest(c, route);

            const res = await controller[route.name](context);

            return this.resolveResponse(c, res, route.statusCode);
          } catch (err) {
            return await this.handleError(c, hostArguments, err);
            // I haven't found a solution to catch the finally :(
            // deno-coverage-ignore-start
          } finally {
            this.options.ctx.clearContext(requestId);
          }
          // deno-coverage-ignore-stop
        },
      );
    };

    if (this.options.cors === true || typeof this.options.cors === "object") {
      this.app.on(
        methodName,
        fullPath,
        this.options.cors === true ? cors() : cors({
          origin: this.options.cors.origin,
          allowMethods: this.options.cors.allowMethods?.map((method) =>
            typeof method === "string" ? method : HttpMethod[method]
          ),
          allowHeaders: this.options.cors.allowHeaders,
          maxAge: this.options.cors.maxAge,
          credentials: this.options.cors.credentials,
          exposeHeaders: this.options.cors.exposeHeaders,
        }),
        middleware,
      );
    } else {
      this.app.on(methodName, fullPath, middleware);
    }

    this.logger.log(`Mapped {${fullPath}, ${methodName}} route`);
  }

  private async validateRequest(
    c: Context,
    route: RequestMappingMetadata,
  ): Promise<unknown> {
    if (!route.validation) {
      return undefined;
    }

    const { type, dto } = route.validation;
    let raw: unknown;

    try {
      raw = type === "json" ? await c.req.json() : await c.req.parseBody();
    } catch {
      throw new BadRequestException("Malformed request body");
    }

    const result = (dto as ZodType).safeParse(raw);

    if (!result.success) {
      throw new ZodValidationException(result.error);
    }

    c.req.addValidatedData(type, result.data as Record<string, unknown>);

    return result.data;
  }

  private resolveResponse(
    c: Context,
    res: unknown,
    statusCode: number | undefined,
  ): Response {
    const status = (statusCode ?? StatusCode.Ok) as 200;

    if (res instanceof Response) {
      return res;
    }

    if (res === undefined || res === null) {
      return c.body(null, StatusCode.NoContent);
    }

    switch (typeof res) {
      case "string":
      case "number":
      case "symbol":
      case "bigint":
      case "boolean":
        return c.text(String(res), status);
      case "object":
        return c.json(res, status);
    }

    throw new UnprocessableContentException();
  }

  private async handleError(
    c: Context,
    hostArguments: HostArguments,
    err: unknown,
  ): Promise<Response> {
    const responsePayload = (await this.options.exceptionHandler.handle(
      err,
      hostArguments,
    )) ??
      (err instanceof HttpException ? err : new InternalServerErrorException(
        typeof err === "string"
          ? err
          : (err instanceof Error ? err.message : undefined),
      ));

    return responsePayload instanceof HttpException
      ? c.json(responsePayload.response, responsePayload.status as 500)
      : (responsePayload as Response);
  }
}
