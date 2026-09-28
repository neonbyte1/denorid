import {
  type CanActivate,
  HttpMethod,
  type HttpRoute,
  type RequestMappingMetadata,
  StatusCode,
} from "@denorid/core";
import type { Type } from "@denorid/injector";
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import { z } from "zod";
import { createDocument } from "./_document.ts";
import {
  ApiExclude,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "./decorators.ts";
import type { OpenApiDocumentOptions } from "./module_options.ts";
import type {
  OperationObject,
  ParameterObject,
  ResponseObject,
  SchemaObject,
} from "./types.ts";

const INFO = { title: "Test API", version: "1.0.0" };

const OPTIONS: OpenApiDocumentOptions = {
  info: INFO,
  components: {
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer" },
      apiKey: { type: "apiKey", name: "X-Key", in: "header" },
      oauth: {
        type: "oauth2",
        flows: {
          clientCredentials: {
            tokenUrl: "/token",
            scopes: { read: "Read", write: "Write" },
          },
        },
      },
    },
  },
};

interface RouteOptions {
  method?: HttpMethod;
  path?: string;
  host?: HttpRoute["host"];
  guards?: HttpRoute["guards"];
  metadata?: Omit<RequestMappingMetadata, "name" | "method">;
}

function route(
  controller: Type,
  name: string | symbol,
  options: RouteOptions = {},
): HttpRoute {
  const method = options.method ?? HttpMethod.GET;

  return {
    method,
    path: options.path ?? "/",
    controller,
    ...(options.host === undefined ? {} : { host: options.host }),
    metadata: { name, method, ...options.metadata },
    guards: options.guards ?? [],
  };
}

function operation(
  routes: HttpRoute[],
  path: string,
  method: "get" | "post" | "put" | "patch" | "delete" | "options" | "head" =
    "get",
): OperationObject | undefined {
  return createDocument(routes, OPTIONS).paths?.[path]?.[method];
}

class PlainController {
  public find(): void {}
  public other(): void {}
}

describe("createDocument()", () => {
  describe("document", () => {
    it("adds the version, the options and the operations by path and method", () => {
      const routes = [
        [HttpMethod.GET, "get"],
        [HttpMethod.POST, "post"],
        [HttpMethod.PUT, "put"],
        [HttpMethod.PATCH, "patch"],
        [HttpMethod.DELETE, "delete"],
        [HttpMethod.OPTIONS, "options"],
        [HttpMethod.HEAD, "head"],
      ] as const;
      const document = createDocument(
        routes.map(([method, name]) =>
          route(PlainController, name, { method, path: "/api/items" })
        ),
        {
          info: INFO,
          servers: [{ url: "https://api.example.com" }],
          tags: [{ name: "items", description: "Items" }],
        },
      );

      assertEquals(document.openapi, "3.2.0");
      assertEquals(document.info, INFO);
      assertEquals(document.servers, [{ url: "https://api.example.com" }]);
      assertEquals(document.tags, [{ name: "items", description: "Items" }]);
      assertEquals(
        Object.keys(document.paths?.["/api/items"] ?? {}),
        routes.map(([, name]) => name),
      );
      assertEquals(document.components, undefined);
    });

    it("keeps the component options and adds the generated schemas", () => {
      class SchemaController {
        @ApiResponse(StatusCode.Ok, {
          schema: z.object({ id: z.string() }).meta({ id: "DocItem" }),
        })
        public find(): void {}
      }

      const document = createDocument([route(SchemaController, "find")], {
        info: INFO,
        components: {
          schemas: { Extra: { type: "string" } },
          securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
        },
      });

      assertEquals(Object.keys(document.components?.schemas ?? {}), [
        "Extra",
        "DocItem",
      ]);
      assertEquals(Object.keys(document.components?.securitySchemes ?? {}), [
        "bearer",
      ]);
    });

    it("documents the first registered route of a method and path", () => {
      class FirstController {
        @ApiOperation({ summary: "First" })
        public find(): void {}
      }

      class SecondController {
        @ApiOperation({ summary: "Second" })
        public find(): void {}
      }

      const routes = [
        route(FirstController, "find", { path: "/items/:id?" }),
        route(SecondController, "find", { path: "/items" }),
        route(SecondController, "find", { path: "/items/:id" }),
      ];

      assertEquals(operation(routes, "/items")?.summary, "First");
      assertEquals(operation(routes, "/items/{id}")?.summary, "First");
    });

    it("leaves out excluded controllers and routes", () => {
      @ApiExclude()
      class HiddenController {
        public find(): void {}
      }

      class PartlyHiddenController {
        @ApiExclude()
        public hidden(): void {}

        public shown(): void {}
      }

      const document = createDocument([
        route(HiddenController, "find", { path: "/hidden" }),
        route(PartlyHiddenController, "hidden", { path: "/partly/hidden" }),
        route(PartlyHiddenController, "shown", { path: "/partly/shown" }),
      ], OPTIONS);

      assertEquals(Object.keys(document.paths ?? {}), ["/partly/shown"]);
    });
  });

  describe("operation fields", () => {
    it("uses <Controller>_<method> as operation id", () => {
      const symbol = Symbol("bySymbol");

      assertEquals(
        operation([route(PlainController, "find")], "/")?.operationId,
        "PlainController_find",
      );
      assertEquals(
        operation([route(PlainController, symbol)], "/")?.operationId,
        "PlainController_bySymbol",
      );
    });

    it("numbers the operation ids of further paths of a route", () => {
      class NumberedController {
        @ApiOperation({ operationId: "findItem" })
        public find(): void {}
      }

      const document = createDocument([
        route(NumberedController, "find", { path: "/items/:id?" }),
        route(NumberedController, "find", { path: "/things" }),
      ], OPTIONS);

      assertEquals(
        [
          document.paths?.["/items"]?.get?.operationId,
          document.paths?.["/items/{id}"]?.get?.operationId,
          document.paths?.["/things"]?.get?.operationId,
        ],
        ["findItem", "findItem_2", "findItem_3"],
      );
    });

    it("sets the fields of @ApiOperation(), the outermost decorator winning", () => {
      class DescribedController {
        @ApiOperation({ summary: "Outer", deprecated: true })
        @ApiOperation({
          summary: "Inner",
          description: "Finds items",
          externalDocs: { url: "https://example.com" },
        })
        public find(): void {}
      }

      const found = operation([route(DescribedController, "find")], "/");

      assertEquals(found?.summary, "Outer");
      assertEquals(found?.description, "Finds items");
      assertEquals(found?.externalDocs, { url: "https://example.com" });
      assertEquals(found?.deprecated, true);
    });

    it("combines the tags of the controller and the route", () => {
      @ApiTags("items", "shared")
      class TaggedController {
        @ApiTags("shared", "read")
        public find(): void {}

        public other(): void {}
      }

      const routes = [
        route(TaggedController, "find", { path: "/find" }),
        route(TaggedController, "other", { path: "/other" }),
      ];

      assertEquals(operation(routes, "/find")?.tags, [
        "items",
        "shared",
        "read",
      ]);
      assertEquals(operation(routes, "/other")?.tags, ["items", "shared"]);
      assertEquals(
        operation([route(PlainController, "find")], "/")?.tags,
        undefined,
      );
    });

    it("keeps the documentation of a parent class unchanged", () => {
      @ApiTags("parent")
      class ParentController {
        @ApiResponse(StatusCode.Ok, { description: "Parent" })
        public find(): void {}
      }

      @ApiTags("child")
      class ChildController extends ParentController {
        @ApiResponse(StatusCode.Ok, { description: "Child" })
        public override find(): void {}
      }

      const parent = operation([route(ParentController, "find")], "/");
      const child = operation([route(ChildController, "find")], "/");

      assertEquals(parent?.tags, ["parent"]);
      assertEquals(parent?.responses?.[200], { description: "Parent" });
      assertEquals(child?.tags, ["parent", "child"]);
      assertEquals(child?.responses?.[200], { description: "Child" });
    });
  });

  describe("parameters", () => {
    it("documents path parameters as strings, with the route pattern", () => {
      assertEquals(
        operation(
          [route(PlainController, "find", {
            path: "/items/:id{[0-9]+}/:slug",
          })],
          "/items/{id}/{slug}",
        )?.parameters,
        [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^(?:[0-9]+)$" },
          },
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
      );
    });

    it("documents path parameters with the @Params() schema", () => {
      const params = z.object({
        id: z.coerce.number().int().positive().describe("Item id"),
        unused: z.string(),
      });

      assertEquals(
        operation(
          [route(PlainController, "find", {
            path: "/items/:id/:slug",
            metadata: { params },
          })],
          "/items/{id}/{slug}",
        )?.parameters,
        [
          {
            name: "id",
            in: "path",
            description: "Item id",
            required: true,
            schema: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              description: "Item id",
            },
          },
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
      );
    });

    it("documents every property of the @Query() schema", () => {
      const query = z.object({
        q: z.string(),
        limit: z.coerce.number().max(100).default(20),
        tags: z.array(z.string()).optional(),
        old: z.string().optional().meta({ deprecated: true }),
      });

      assertEquals(
        operation(
          [route(PlainController, "find", { metadata: { query } })],
          "/",
        )?.parameters,
        [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { default: 20, type: "number", maximum: 100 },
          },
          {
            name: "tags",
            in: "query",
            required: false,
            schema: { type: "array", items: { type: "string" } },
          },
          {
            name: "old",
            in: "query",
            required: false,
            deprecated: true,
            schema: { type: "string", deprecated: true },
          },
        ],
      );
    });

    it("documents a @Query() schema with id through its properties", () => {
      const query = z.object({ q: z.string() }).meta({ id: "SearchQuery" });
      const document = createDocument(
        [route(PlainController, "find", { metadata: { query } })],
        OPTIONS,
      );

      assertEquals(document.paths?.["/"]?.get?.parameters, [
        { name: "q", in: "query", required: true, schema: { type: "string" } },
      ]);
      assertEquals(document.components?.schemas, undefined);
    });

    it("documents other @Query() schemas as the whole query string", () => {
      const query = z.union([
        z.object({ id: z.string() }),
        z.object({ slug: z.string() }),
      ]);
      const [parameter] = operation(
        [route(PlainController, "find", { metadata: { query } })],
        "/",
      )?.parameters ?? [];

      assertEquals(parameter, {
        name: "query",
        in: "querystring",
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              anyOf: [
                {
                  type: "object",
                  properties: { id: { type: "string" } },
                  required: ["id"],
                },
                {
                  type: "object",
                  properties: { slug: { type: "string" } },
                  required: ["slug"],
                },
              ],
            },
          },
        },
      });
    });

    it("documents the properties of the @RequestHeaders() schema", () => {
      const headers = z.object({
        "x-tenant-id": z.uuid().describe("Tenant"),
        "x-trace": z.string().optional(),
        accept: z.string(),
        "Content-Type": z.string(),
        authorization: z.string(),
      });

      assertEquals(
        operation(
          [route(PlainController, "find", { metadata: { headers } })],
          "/",
        )?.parameters?.map((parameter) => {
          const { name, in: location, required, description } =
            parameter as ParameterObject;

          return { name, location, required, description };
        }),
        [
          {
            name: "x-tenant-id",
            location: "header",
            required: true,
            description: "Tenant",
          },
          {
            name: "x-trace",
            location: "header",
            required: false,
            description: undefined,
          },
        ],
      );
    });

    it("leaves out @RequestHeaders() schemas without properties", () => {
      const headers = z.record(z.string(), z.string());

      assertEquals(
        operation(
          [route(PlainController, "find", { metadata: { headers } })],
          "/",
        )?.parameters,
        undefined,
      );
    });

    it("lists path, query and header parameters in this order", () => {
      assertEquals(
        operation(
          [route(PlainController, "find", {
            path: "/:id",
            metadata: {
              headers: z.object({ "x-a": z.string().optional() }),
              query: z.object({ b: z.string() }),
            },
          })],
          "/{id}",
        )?.parameters?.map((parameter) => (parameter as ParameterObject).in),
        ["path", "query", "header"],
      );
    });
  });

  describe("servers", () => {
    it("documents the hosts of host-restricted routes", () => {
      const found = operation(
        [route(PlainController, "find", {
          host: ["api.example.com", /^(.+)\.example\.com$/],
        })],
        "/",
      );

      assertEquals(found?.servers, [
        { url: "//api.example.com" },
        {
          url: "//{host}",
          description: "Hosts matching /^(.+)\\.example\\.com$/",
          variables: {
            host: {
              default: "",
              description: "A host matching /^(.+)\\.example\\.com$/",
            },
          },
        },
      ]);
      assertEquals(
        operation(
          [route(PlainController, "find", { host: "admin.example.com" })],
          "/",
        )?.servers,
        [{ url: "//admin.example.com" }],
      );
      assertEquals(
        operation([route(PlainController, "find")], "/")?.servers,
        undefined,
      );
    });

    it("leaves out routes of controllers serving no host", () => {
      assertEquals(
        createDocument(
          [route(PlainController, "find", { host: [] })],
          OPTIONS,
        ).paths,
        {},
      );
    });
  });

  describe("request body", () => {
    it("documents a @Body() schema as a required JSON body", () => {
      const dto = z.object({ name: z.string() });

      assertEquals(
        operation(
          [route(PlainController, "find", {
            method: HttpMethod.POST,
            metadata: { validation: { type: "json", dto } },
          })],
          "/",
          "post",
        )?.requestBody,
        {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        },
      );
    });

    it("documents a @Form() schema as multipart and url-encoded body", () => {
      const dto = z.object({ file: z.file() });
      const body = operation(
        [route(PlainController, "find", {
          method: HttpMethod.POST,
          metadata: { validation: { type: "form", dto } },
        })],
        "/",
        "post",
      )?.requestBody;
      const schema: SchemaObject = {
        type: "object",
        properties: {
          file: { type: "string", format: "binary", contentEncoding: "binary" },
        },
        required: ["file"],
      };

      assertEquals(body, {
        required: true,
        content: {
          "multipart/form-data": { schema },
          "application/x-www-form-urlencoded": { schema },
        },
      });
    });

    it("replaces the body with the one of @ApiOperation()", () => {
      const requestBody = {
        content: {
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        },
      } as const;

      class UploadController {
        @ApiOperation({ requestBody })
        public upload(): void {}
      }

      const found = operation(
        [route(UploadController, "upload", {
          method: HttpMethod.PUT,
          metadata: { validation: { type: "json", dto: z.string() } },
        })],
        "/",
        "put",
      );

      assertEquals(found?.requestBody, requestBody);
    });
  });

  describe("responses", () => {
    it("adds the success status of the route", () => {
      assertEquals(
        operation([route(PlainController, "find")], "/")?.responses,
        { 200: { description: "OK" } },
      );
      assertEquals(
        operation(
          [route(PlainController, "find", {
            metadata: { statusCode: StatusCode.NoContent },
          })],
          "/",
        )?.responses,
        { 204: { description: "No Content" } },
      );
    });

    it("keeps documented success responses and adds one to error-only routes", () => {
      class DocumentedController {
        @ApiResponse(StatusCode.Created, { description: "Stored" })
        public create(): void {}

        @ApiResponse(StatusCode.Found)
        public redirect(): void {}

        @ApiResponse(StatusCode.NotFound)
        @ApiResponse("default", { description: "Error" })
        public find(): void {}
      }

      const routes = [
        route(DocumentedController, "create", { path: "/create" }),
        route(DocumentedController, "redirect", { path: "/redirect" }),
        route(DocumentedController, "find", { path: "/find" }),
      ];

      assertEquals(operation(routes, "/create")?.responses, {
        201: { description: "Stored" },
      });
      assertEquals(operation(routes, "/redirect")?.responses, {
        302: { description: "Found" },
      });
      assertEquals(operation(routes, "/find")?.responses, {
        200: { description: "OK" },
        404: { description: "Not Found" },
        default: { description: "Error" },
      });
    });

    it("applies controller responses, replaced by route responses", () => {
      @ApiResponse(StatusCode.Unauthorized, { description: "No session" })
      @ApiResponse(StatusCode.NotFound, { description: "Missing" })
      class ScopedController {
        @ApiResponse(StatusCode.NotFound, { description: "No item" })
        public find(): void {}
      }

      assertEquals(
        operation([route(ScopedController, "find")], "/")?.responses,
        {
          200: { description: "OK" },
          401: { description: "No session" },
          404: { description: "No item" },
        },
      );
    });

    it("lets the outermost @ApiResponse() of a status win", () => {
      class TwiceController {
        @ApiResponse(StatusCode.Ok, { description: "Outer" })
        @ApiResponse(StatusCode.Ok, { description: "Inner" })
        public find(): void {}
      }

      assertEquals(
        operation([route(TwiceController, "find")], "/")?.responses,
        {
          200: { description: "Outer" },
        },
      );
    });

    it("picks the media type the adapter sends", () => {
      class TypedController {
        @ApiResponse(StatusCode.Ok, { schema: z.object({ id: z.string() }) })
        @ApiResponse(StatusCode.Created, { schema: z.string().nullable() })
        @ApiResponse(StatusCode.Accepted, { schema: z.number() })
        @ApiResponse(StatusCode.NotFound, {
          schema: z.enum(["gone"]).meta({ id: "GoneReason" }),
        })
        @ApiResponse(StatusCode.Conflict, { schema: z.null() })
        @ApiResponse(StatusCode.Gone, {
          schema: z.string(),
          contentType: "text/csv",
        })
        @ApiResponse(StatusCode.Locked, {
          schema: z.union([z.string(), z.number()]),
        })
        @ApiResponse(StatusCode.TooEarly, {
          schema: z.union([z.string(), z.object({ id: z.string() })]),
        })
        @ApiResponse(StatusCode.PreconditionFailed, { schema: z.unknown() })
        public find(): void {}
      }

      const responses = operation([route(TypedController, "find")], "/")
        ?.responses as Record<string, { content: Record<string, unknown> }>;

      assertEquals(
        Object.fromEntries(
          Object.entries(responses).map((
            [status, { content }],
          ) => [status, Object.keys(content)]),
        ),
        {
          200: ["application/json"],
          201: ["text/plain"],
          202: ["text/plain"],
          404: ["text/plain"],
          409: ["application/json"],
          410: ["text/csv"],
          412: ["application/json"],
          423: ["text/plain"],
          425: ["application/json"],
        },
      );
    });

    it("describes default and non-standard statuses", () => {
      const nonStandard = 299 as StatusCode;

      class UnusualController {
        @ApiResponse("default")
        @ApiResponse(nonStandard)
        public find(): void {}
      }

      assertEquals(
        operation([route(UnusualController, "find")], "/")?.responses,
        {
          299: { description: "Response" },
          default: { description: "Default response" },
        },
      );
      assertEquals(
        operation(
          [route(PlainController, "find", {
            metadata: { statusCode: nonStandard },
          })],
          "/",
        )?.responses,
        { 299: { description: "Response" } },
      );
    });

    it("documents response schemas as output", () => {
      class OutputController {
        @ApiResponse(StatusCode.Ok, {
          schema: z.object({ n: z.number().default(1) }),
        })
        public find(): void {}
      }

      assertEquals(
        operation([route(OutputController, "find")], "/")?.responses?.[200],
        {
          description: "OK",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { n: { default: 1, type: "number" } },
                required: ["n"],
                additionalProperties: false,
              },
            },
          },
        },
      );
    });

    it("adds 400 to routes validating input and 403 to guarded routes", () => {
      const schema = z.object({ id: z.string() });
      const guard = (): boolean => true;
      const statuses = (
        metadata: RouteOptions["metadata"],
        guards: HttpRoute["guards"] = [],
      ): string[] =>
        Object.keys(
          operation(
            [route(PlainController, "find", { metadata, guards })],
            "/",
          )?.responses ?? {},
        );

      assertEquals(statuses({ params: schema }), ["200", "400"]);
      assertEquals(statuses({ query: schema }), ["200", "400"]);
      assertEquals(statuses({ headers: schema }), ["200", "400"]);
      assertEquals(statuses({ validation: { type: "json", dto: schema } }), [
        "200",
        "400",
      ]);
      assertEquals(statuses({}, [guard]), ["200", "403"]);
    });

    it("keeps documented 400 and 403 responses", () => {
      class ErrorController {
        @ApiResponse(StatusCode.BadRequest, { description: "Invalid" })
        @ApiResponse(StatusCode.Forbidden, { description: "Denied" })
        public find(): void {}
      }

      assertEquals(
        operation(
          [route(ErrorController, "find", {
            metadata: { query: z.object({}) },
            guards: [(): boolean => true],
          })],
          "/",
        )?.responses,
        {
          200: { description: "OK" },
          400: { description: "Invalid" },
          403: { description: "Denied" },
        },
      );
    });

    describe("of guards", () => {
      @ApiSecurity("bearer")
      @ApiResponse(StatusCode.Unauthorized, { description: "No session" })
      class SessionGuard implements CanActivate {
        public canActivate(): boolean {
          return true;
        }
      }

      @ApiResponse(StatusCode.TooManyRequests)
      class RateLimitGuard implements CanActivate {
        public canActivate(): boolean {
          return true;
        }
      }

      @ApiSecurity("bearer")
      class BearerGuard implements CanActivate {
        public canActivate(): boolean {
          return true;
        }
      }

      it("documents the responses of guard classes and instances instead of 403", () => {
        assertEquals(
          operation(
            [route(PlainController, "find", {
              guards: [SessionGuard, new RateLimitGuard()],
            })],
            "/",
          )?.responses,
          {
            200: { description: "OK" },
            401: { description: "No session" },
            429: { description: "Too Many Requests" },
          },
        );
      });

      it("adds 403 for another guard without documented responses", () => {
        const statuses = (guards: HttpRoute["guards"]): string[] =>
          Object.keys(
            operation([route(PlainController, "find", { guards })], "/")
              ?.responses ?? {},
          );

        assertEquals(statuses([SessionGuard, BearerGuard]), [
          "200",
          "401",
          "403",
        ]);
        assertEquals(statuses([(): boolean => true, SessionGuard]), [
          "200",
          "401",
          "403",
        ]);
      });

      it("lets later guards, the controller and the route replace guard responses", () => {
        @ApiResponse(StatusCode.Unauthorized, { description: "Expired" })
        @ApiResponse(StatusCode.BadRequest, { description: "Bad token" })
        class TokenGuard implements CanActivate {
          public canActivate(): boolean {
            return true;
          }
        }

        @ApiResponse(StatusCode.TooManyRequests, { description: "Slow down" })
        class LimitedController {
          public find(): void {}
        }

        assertEquals(
          operation(
            [route(LimitedController, "find", {
              metadata: { query: z.object({}) },
              guards: [SessionGuard, TokenGuard, RateLimitGuard],
            })],
            "/",
          )?.responses,
          {
            200: { description: "OK" },
            400: { description: "Bad token" },
            401: { description: "Expired" },
            429: { description: "Slow down" },
          },
        );
      });

      it("keeps the success response when a guard documents a redirect", () => {
        @ApiResponse(StatusCode.Found, { description: "To the login page" })
        class LoginRedirectGuard implements CanActivate {
          public canActivate(): boolean {
            return true;
          }
        }

        assertEquals(
          operation(
            [route(PlainController, "find", {
              metadata: { statusCode: StatusCode.Created },
              guards: [LoginRedirectGuard],
            })],
            "/",
          )?.responses,
          {
            201: { description: "Created" },
            302: { description: "To the login page" },
          },
        );
      });
    });
  });

  describe("streamed responses", () => {
    const LogEntry = z.object({ level: z.number(), message: z.string() });
    const Chat = z.object({ text: z.string() }).meta({ id: "StreamChat" });

    it("documents item schemas as JSON Lines by default", () => {
      class StreamController {
        @ApiResponse(StatusCode.Ok, { itemSchema: LogEntry })
        @ApiResponse(StatusCode.Accepted, {
          itemSchema: LogEntry,
          contentType: "application/x-ndjson",
        })
        @ApiResponse(StatusCode.PartialContent, {
          schema: z.array(LogEntry),
          itemSchema: LogEntry,
        })
        public logs(): void {}
      }

      const responses = operation([route(StreamController, "logs")], "/")
        ?.responses as Record<string, ResponseObject>;
      const item: SchemaObject = {
        type: "object",
        properties: { level: { type: "number" }, message: { type: "string" } },
        required: ["level", "message"],
        additionalProperties: false,
      };

      assertEquals(responses[200].content, {
        "application/jsonl": { itemSchema: item },
      });
      assertEquals(responses[202].content, {
        "application/x-ndjson": { itemSchema: item },
      });
      assertEquals(responses[206].content, {
        "application/jsonl": {
          schema: { type: "array", items: item },
          itemSchema: item,
        },
      });
    });

    it("documents server-sent events by name", () => {
      class EventsController {
        @ApiResponse(StatusCode.Ok, {
          description: "Chat events",
          events: { message: Chat, ping: z.string() },
        })
        public events(): void {}
      }

      const document = createDocument(
        [route(EventsController, "events")],
        OPTIONS,
      );

      assertEquals(document.paths?.["/"]?.get?.responses?.[200], {
        description: "Chat events",
        content: {
          "text/event-stream": {
            itemSchema: {
              type: "object",
              properties: {
                event: { type: "string" },
                data: { type: "string" },
                id: { type: "string" },
                retry: { type: "integer", minimum: 0 },
              },
              required: ["data"],
              oneOf: [
                {
                  properties: {
                    event: { const: "message" },
                    data: {
                      type: "string",
                      contentMediaType: "application/json",
                      contentSchema: {
                        $ref: "#/components/schemas/StreamChat",
                      },
                    },
                  },
                },
                {
                  properties: {
                    event: { const: "ping" },
                    data: { type: "string" },
                  },
                  required: ["event"],
                },
              ],
            },
          },
        },
      });
      assertEquals(Object.keys(document.components?.schemas ?? {}), [
        "StreamChat",
      ]);
    });

    it("keeps a custom event media type and leaves out empty alternatives", () => {
      class EmptyEventsController {
        @ApiResponse(StatusCode.Ok, {
          events: {},
          contentType: "text/event-stream; charset=utf-8",
        })
        public events(): void {}
      }

      assertEquals(
        operation([route(EmptyEventsController, "events")], "/")?.responses
          ?.[200],
        {
          description: "OK",
          content: {
            "text/event-stream; charset=utf-8": {
              itemSchema: {
                type: "object",
                properties: {
                  event: { type: "string" },
                  data: { type: "string" },
                  id: { type: "string" },
                  retry: { type: "integer", minimum: 0 },
                },
                required: ["data"],
              },
            },
          },
        },
      );
    });
  });

  describe("security", () => {
    @ApiSecurity("bearer")
    class BearerGuard implements CanActivate {
      public canActivate(): boolean {
        return true;
      }
    }

    @ApiSecurity({ oauth: ["read"] }, "apiKey")
    class ClientGuard implements CanActivate {
      public canActivate(): boolean {
        return true;
      }
    }

    it("requires the schemes of guard classes, instances and controllers", () => {
      @ApiSecurity({ oauth: ["write"] })
      class SecuredController {
        @ApiSecurity({ oauth: ["read"] })
        public find(): void {}
      }

      assertEquals(
        operation(
          [route(SecuredController, "find", {
            guards: [BearerGuard, new BearerGuard(), (): boolean => true],
          })],
          "/",
        )?.security,
        [{ bearer: [], oauth: ["write", "read"] }],
      );
    });

    it("combines the alternatives of every requirement", () => {
      assertEquals(
        operation(
          [route(PlainController, "find", {
            guards: [BearerGuard, ClientGuard],
          })],
          "/",
        )?.security,
        [{ bearer: [], oauth: ["read"] }, { bearer: [], apiKey: [] }],
      );
    });

    it("lists equal alternatives once", () => {
      @ApiSecurity("bearer", "bearer")
      class RepeatingController {
        public find(): void {}
      }

      assertEquals(
        operation([route(RepeatingController, "find")], "/")?.security,
        [{ bearer: [] }],
      );
    });

    it("leaves out the security of routes without requirements", () => {
      assertEquals(
        operation([route(PlainController, "find")], "/")?.security,
        undefined,
      );
    });

    it("documents public routes and controllers without requirements", () => {
      class PublicRouteController {
        @ApiSecurity()
        @ApiSecurity("bearer")
        public find(): void {}
      }

      @ApiSecurity()
      class PublicController {
        public find(): void {}

        @ApiSecurity("apiKey")
        public keyed(): void {}
      }

      const guards = [BearerGuard];

      assertEquals(
        operation([route(PublicRouteController, "find", { guards })], "/")
          ?.security,
        [],
      );
      assertEquals(
        operation([route(PublicController, "find", { guards })], "/")
          ?.security,
        [],
      );
      assertEquals(
        operation([route(PublicController, "keyed", { guards })], "/")
          ?.security,
        [{ apiKey: [] }],
      );
    });

    it("throws when a required scheme is not defined", () => {
      @ApiSecurity("session")
      class UnknownSchemeController {
        public find(): void {}
      }

      assertThrows(
        () =>
          createDocument(
            [route(UnknownSchemeController, "find", { path: "/me" })],
            OPTIONS,
          ),
        Error,
        'The route GET /me requires the security scheme "session"',
      );
    });

    it("accepts security scheme URIs without definition", () => {
      const uri = "https://auth.example.com/openapi.json#/components/" +
        "securitySchemes/oidc";

      @ApiSecurity(uri)
      class ExternalSchemeController {
        public find(): void {}
      }

      assertEquals(
        operation([route(ExternalSchemeController, "find")], "/")?.security,
        [{ [uri]: [] }],
      );
    });
  });
});
