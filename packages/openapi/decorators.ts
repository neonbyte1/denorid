import type { StatusCode } from "@denorid/core";
import {
  type ClassMethodDecoratorInitializer,
  type Decorator,
  InvalidStaticMemberDecoratorUsageError,
  type MethodDecorator,
  type Type,
} from "@denorid/injector";
import type { ZodType } from "zod";
import {
  type ApiMetadata,
  ownClassMetadata,
  ownRouteMetadata,
} from "./_metadata.ts";
import type {
  ExternalDocumentationObject,
  RequestBodyObject,
  SecurityRequirementObject,
} from "./types.ts";

/** Fields of an operation set with {@link ApiOperation}. */
export interface ApiOperationOptions {
  /** Short summary of the operation. */
  summary?: string;
  /** Description of the operation; CommonMark is allowed. */
  description?: string;
  /**
   * Unique id of the operation. Defaults to `<Controller>_<method>`, e.g.
   * `UserController_findOne`. A route with several paths gets `_2`, `_3`,
   * ... appended for the second and later paths.
   */
  operationId?: string;
  /** Marks the operation as deprecated. */
  deprecated?: boolean;
  /** Additional external documentation. */
  externalDocs?: ExternalDocumentationObject;
  /**
   * Replaces the request body generated from `@Body()` or `@Form()`, e.g. to
   * document a raw upload the route reads itself.
   */
  requestBody?: RequestBodyObject;
}

/** Fields shared by every response documented with {@link ApiResponse}. */
export interface ApiResponseBaseOptions {
  /** Description of the response. Defaults to the status text, e.g. `OK`. */
  description?: string;
  /**
   * Media type of the body. Defaults to `application/jsonl` with an
   * `itemSchema`, `text/event-stream` with `events`, and otherwise to how the
   * HTTP adapter sends a handler result: `text/plain` for string, number and
   * boolean schemas, `application/json` for others.
   */
  contentType?: string;
}

/** A response with a body, or a stream of items, documented by zod schemas. */
export interface ApiResponseBodyOptions extends ApiResponseBaseOptions {
  /**
   * Zod schema of the response body, documented as its output (the parsed
   * type, `z.infer<typeof schema>`).
   */
  schema?: ZodType;
  /**
   * Zod schema of every item of a streamed response in a sequential media
   * type, e.g. one line of `application/jsonl` (the default media type),
   * `application/x-ndjson` or `application/json-seq`. Documented as output.
   */
  itemSchema?: ZodType;
  /** Not with `schema` or `itemSchema`. */
  events?: never;
}

/** A stream of server-sent events (`text/event-stream`). */
export interface ApiResponseEventsOptions extends ApiResponseBaseOptions {
  /**
   * The events of the stream, by event name: the zod schema of the `data`
   * field. Data of string schemas is documented as sent as is, other data as
   * JSON. The `message` event also covers events sent without `event` field.
   */
  events: Record<string, ZodType>;
  /** Not with `events`. */
  schema?: never;
  /** Not with `events`. */
  itemSchema?: never;
}

/** A response documented with {@link ApiResponse}. */
export type ApiResponseOptions =
  | ApiResponseBodyOptions
  | ApiResponseEventsOptions;

/** Status of a documented response; `default` covers every other status. */
export type ApiResponseStatus = StatusCode | "default";

/**
 * Throws when a method decorator is applied to a static or `#private`
 * method, which are never routes.
 *
 * @param {string} decorator - Decorator name, without `@` and `()`.
 * @param {ClassMethodDecoratorContext} ctx - Decorator context of the method.
 * @return {void}
 * @throws {InvalidStaticMemberDecoratorUsageError} For a static method.
 * @throws {Error} For a `#private` method.
 */
function assertInstanceMethod(
  decorator: string,
  ctx: ClassMethodDecoratorContext,
): void {
  if (ctx.static) {
    throw new InvalidStaticMemberDecoratorUsageError(
      decorator,
      ctx.name,
      "function",
    );
  }

  if (ctx.private) {
    throw new Error(
      `Decorator @${decorator}() cannot be applied to private function "${
        String(ctx.name)
      }". Use a member without "#" instead.`,
    );
  }
}

/**
 * Creates a decorator for classes and methods that updates the documentation
 * of the class (all of its routes) or of the decorated route.
 *
 * @param {string} name - Decorator name, used in error messages.
 * @param {(metadata: ApiMetadata) => void} apply - Updates the documentation.
 * @return {Decorator<ClassDecoratorContext, Type> & MethodDecorator} The
 *   decorator.
 */
function createApiDecorator(
  name: string,
  apply: (metadata: ApiMetadata) => void,
): Decorator<ClassDecoratorContext, Type> & MethodDecorator {
  const decorator = function <
    T extends object,
    V extends ClassMethodDecoratorInitializer<T>,
  >(
    target: V,
    ctx: ClassDecoratorContext | ClassMethodDecoratorContext<T, V>,
  ): V {
    if (ctx.kind === "method") {
      assertInstanceMethod(name, ctx as ClassMethodDecoratorContext);
      apply(ownRouteMetadata(ctx.metadata, ctx.name));
    } else {
      apply(ownClassMetadata(ctx.metadata));
    }

    return target;
  };

  return decorator as Decorator<ClassDecoratorContext, Type> & MethodDecorator;
}

/**
 * Groups the operations of a controller or of one route under tags. Tags of
 * the controller and of the route are combined.
 *
 * @example
 * ```ts
 * \@ApiTags("forum")
 * \@Controller("/forum")
 * class ForumController {}
 * ```
 *
 * @param {...string} tags - Tag names.
 * @return {Decorator<ClassDecoratorContext, Type> & MethodDecorator} A
 *   decorator for controller classes and route methods.
 */
export function ApiTags(
  ...tags: string[]
): Decorator<ClassDecoratorContext, Type> & MethodDecorator {
  return createApiDecorator("ApiTags", (metadata) => {
    metadata.tags.push(...tags);
  });
}

/**
 * Sets the summary, description, operation id and other fields of a route's
 * operation. Applied several times, the fields are merged and the outermost
 * decorator wins.
 *
 * @example
 * ```ts
 * \@Get("/:id")
 * \@ApiOperation({ summary: "Finds a thread", operationId: "getThread" })
 * public findOne(ctx: RequestContext): Promise<Thread> {}
 * ```
 *
 * @param {ApiOperationOptions} options - Operation fields.
 * @return {MethodDecorator} A decorator for route methods.
 */
export function ApiOperation(options: ApiOperationOptions): MethodDecorator {
  return function <
    T extends object,
    V extends ClassMethodDecoratorInitializer<T>,
  >(target: V, ctx: ClassMethodDecoratorContext<T, V>): V {
    assertInstanceMethod("ApiOperation", ctx as ClassMethodDecoratorContext);

    const route = ownRouteMetadata(ctx.metadata, ctx.name);

    route.operation = { ...route.operation, ...options };

    return target;
  };
}

/**
 * Documents a response of a route, of every route of a controller (e.g.
 * `401` for a controller behind authentication), or of every route running a
 * guard (globally, on its controller or on the route). A route response
 * replaces the controller response with the same status, which replaces the
 * guard response; for the same status on the same class or method, the
 * outermost decorator wins.
 *
 * Routes without a `1xx`-`3xx` response documented on the controller or the
 * route get the success response of the framework: the `@HttpCode()`
 * status, `200` without one.
 *
 * Routes running a guard get `403` (the response of a guard returning
 * `false`) unless the guard documents its own responses, e.g. `401` of an
 * authentication guard throwing `UnauthorizedException`.
 *
 * Streamed responses (OpenAPI 3.2 sequential media types) are documented per
 * item: `itemSchema` for JSON Lines and similar formats, `events` for
 * server-sent events.
 *
 * @example
 * ```ts
 * \@Post()
 * \@Body(CreateThread)
 * \@HttpCode(StatusCode.Created)
 * \@ApiResponse(StatusCode.Created, { schema: ThreadView })
 * \@ApiResponse(StatusCode.NotFound, { description: "Unknown category" })
 * public create(ctx: RequestContext<typeof CreateThread>): Promise<unknown> {}
 * ```
 *
 * @example Streams
 * ```ts
 * \@Get("/logs")
 * \@ApiResponse(StatusCode.Ok, { itemSchema: LogEntry })
 * public logs(): Response {}
 *
 * \@Get("/events")
 * \@ApiResponse(StatusCode.Ok, {
 *   events: { message: ChatMessage, typing: z.object({ userId: z.uuid() }) },
 * })
 * public events(): Response {}
 * ```
 *
 * @example Guards
 * ```ts
 * \@ApiSecurity("bearer")
 * \@ApiResponse(StatusCode.Unauthorized)
 * \@Injectable()
 * class SessionGuard implements CanActivate {}
 *
 * \@ApiResponse(StatusCode.TooManyRequests)
 * \@Injectable()
 * class WriteRateLimitGuard implements CanActivate {}
 * ```
 *
 * @param {ApiResponseStatus} status - Status code, or `default`.
 * @param {ApiResponseOptions} [options] - Description, body or item schema,
 *   events and media type.
 * @return {Decorator<ClassDecoratorContext, Type> & MethodDecorator} A
 *   decorator for guard and controller classes and route methods.
 */
export function ApiResponse(
  status: ApiResponseStatus,
  options: ApiResponseOptions = {},
): Decorator<ClassDecoratorContext, Type> & MethodDecorator {
  return createApiDecorator("ApiResponse", (metadata) => {
    metadata.responses.set(status, options);
  });
}

/**
 * Declares the security schemes a route needs: names of schemes defined in
 * `document.components.securitySchemes` of the module options, or URIs of
 * security schemes (e.g. `other.json#/components/securitySchemes/oidc`).
 *
 * Applied to a guard class, every route running the guard (globally, on its
 * controller or on the route) requires the schemes. Applied to a controller
 * or a route method, it adds to the requirements of the guards. Every
 * argument is an alternative (either one is accepted); every decorator is
 * required on its own (all of them are needed).
 *
 * Without arguments, the route (or every route of the controller) is
 * documented as public, whatever its guards require, e.g. for routes a
 * global authentication guard lets through.
 *
 * @example
 * ```ts
 * \@ApiSecurity("bearer")
 * \@Injectable()
 * class AuthGuard implements CanActivate {}
 *
 * \@UseGuards(AuthGuard)
 * \@Controller("/users")
 * class UserController {
 *   \@Get("/me")
 *   public me(): unknown {} // requires "bearer"
 *
 *   \@Post("/login")
 *   \@ApiSecurity()
 *   public login(): unknown {} // public
 * }
 * ```
 *
 * @param {...(string | SecurityRequirementObject)} requirements - Accepted
 *   alternatives: a scheme name, or an object of scheme names with their
 *   scopes (all required together).
 * @return {Decorator<ClassDecoratorContext, Type> & MethodDecorator} A
 *   decorator for guard and controller classes and route methods.
 */
export function ApiSecurity(
  ...requirements: (string | SecurityRequirementObject)[]
): Decorator<ClassDecoratorContext, Type> & MethodDecorator {
  return createApiDecorator("ApiSecurity", (metadata) => {
    if (requirements.length === 0) {
      metadata.public = true;
    } else {
      metadata.security.push(
        requirements.map((requirement) =>
          typeof requirement === "string" ? { [requirement]: [] } : requirement
        ),
      );
    }
  });
}

/**
 * Leaves a controller or a single route out of the document.
 *
 * @return {Decorator<ClassDecoratorContext, Type> & MethodDecorator} A
 *   decorator for controller classes and route methods.
 */
export function ApiExclude():
  & Decorator<ClassDecoratorContext, Type>
  & MethodDecorator {
  return createApiDecorator("ApiExclude", (metadata) => {
    metadata.exclude = true;
  });
}
