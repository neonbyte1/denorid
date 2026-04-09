import {
  BadRequestException,
  ControllerMapping,
  type ExceptionHandler,
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
import type { InjectorContext, Type } from "@denorid/injector";
import type { Context, Hono } from "@hono/hono";
import type { ZodType } from "zod";
import { HonoRequestContext } from "./request_context.ts";

export class HonoControllerMapping extends ControllerMapping {
  public constructor(
    private readonly app: Hono,
    ctx: InjectorContext,
    exceptionHandler: ExceptionHandler,
  ) {
    super(ctx, exceptionHandler);
  }

  /**
   * @inheritdoc
   */
  // deno-lint-ignore require-await
  protected override async registerRoute(
    controllerClass: Type<HttpController>,
    controllerBasePath: string,
    route: RequestMappingMetadata,
  ): Promise<void> {
    const fullPath = this.joinPaths(
      controllerBasePath,
      ...this.normalizePaths(route.path),
    );

    const methodName = HttpMethod[route.method ?? HttpMethod.GET];

    this.app.on(methodName, fullPath, async (c) => {
      const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();

      return await this.ctx.runInRequestScopeAsync(requestId, async () => {
        const controller = await this.ctx.resolveInternal<HttpController>(
          controllerClass,
        );

        try {
          const validatedDto = await this.validateRequest(c, route);
          const res = await controller[route.name](
            new HonoRequestContext(c, validatedDto),
          );
          return this.resolveResponse(c, res, route.statusCode);
        } catch (err) {
          return await this.handleError(c, err);
        }
      });
    });

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

  private async handleError(c: Context, err: unknown): Promise<Response> {
    const responsePayload = (await this.exceptionHandler.handle(
      err,
      this.createHostArguments(c),
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

  private createHostArguments(c: Context): HostArguments {
    return {
      switchToHttp: () => ({
        getRequest: <T>() => c.req as T,
        getResponse: <T>() => c as T,
      }),
    };
  }
}
