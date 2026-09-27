import {
  HttpMethod,
  type HttpRoute,
  STATUS_TEXT,
  StatusCode,
} from "@denorid/core";
import type { ZodType } from "zod";
import {
  type ApiMetadata,
  type ApiRouteMetadata,
  readClassMetadata,
  readRouteMetadata,
} from "./_metadata.ts";
import { type PathTemplate, toPathTemplates } from "./_paths.ts";
import { type ConvertedSchema, SchemaCollector } from "./_schemas.ts";
import type { ApiResponseOptions, ApiResponseStatus } from "./decorators.ts";
import type { OpenApiDocumentOptions } from "./module_options.ts";
import type {
  ComponentsObject,
  MediaTypeObject,
  OpenAPIObject,
  OperationObject,
  ParameterLocation,
  ParameterObject,
  PathItemObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
  SecurityRequirementObject,
  ServerObject,
} from "./types.ts";

/** Version of the OpenAPI specification of the generated documents. */
const OPENAPI_VERSION = "3.2.0";

/**
 * A security requirement key that is a URI of a scheme rather than the name
 * of one in `components.securitySchemes` (a scheme, fragment or path).
 */
const SCHEME_URI = /[:#/]/;

/** Path item field of every HTTP method. */
const OPERATION_METHODS: Record<
  HttpMethod,
  "get" | "post" | "put" | "patch" | "delete" | "options" | "head"
> = {
  [HttpMethod.GET]: "get",
  [HttpMethod.POST]: "post",
  [HttpMethod.PUT]: "put",
  [HttpMethod.PATCH]: "patch",
  [HttpMethod.DELETE]: "delete",
  [HttpMethod.OPTIONS]: "options",
  [HttpMethod.HEAD]: "head",
};

/** JSON Schema types the HTTP adapter sends as `text/plain`. */
const TEXT_TYPES: Record<string, true> = {
  string: true,
  number: true,
  integer: true,
  boolean: true,
};

/**
 * Header parameters OpenAPI ignores: the media type negotiation and the
 * credentials are described by the operation and its security.
 */
const IGNORED_HEADERS: Record<string, true> = {
  accept: true,
  "content-type": true,
  authorization: true,
};

/** Documentation of a class or method without documentation decorators. */
const NO_METADATA: ApiRouteMetadata = {
  tags: [],
  responses: new Map(),
  security: [],
  public: false,
  exclude: false,
  operation: {},
};

/** Schemas of a route, converted once for all of its path templates. */
interface RouteSchemas {
  /** Resolved `@Params()` schema. */
  params?: SchemaObject;
  /** `@Query()` schema. */
  query?: ConvertedSchema;
  /** Resolved `@RequestHeaders()` schema. */
  headers?: SchemaObject;
  /** Request body generated from `@Body()` or `@Form()`. */
  requestBody?: RequestBodyObject;
}

/**
 * Creates a parameter from the JSON Schema of its value; the description and
 * the deprecation of the schema are repeated on the parameter, where
 * documentation tools show them.
 *
 * @param {string} name - Name of the parameter.
 * @param {ParameterLocation} location - Location of the parameter.
 * @param {boolean} required - Whether the parameter is required.
 * @param {unknown} schema - Schema of the value.
 * @return {ParameterObject} The parameter.
 */
function createParameter(
  name: string,
  location: ParameterLocation,
  required: boolean,
  schema: unknown,
): ParameterObject {
  const { description, deprecated } = schema as SchemaObject;

  return {
    name,
    in: location,
    ...(description === undefined ? {} : { description }),
    required,
    ...(deprecated === true ? { deprecated } : {}),
    schema: schema as SchemaObject,
  };
}

/**
 * Creates the path parameters of a template. A parameter without property in
 * the `@Params()` schema is a string, restricted to its `{pattern}`.
 *
 * @param {PathTemplate} template - The path template.
 * @param {SchemaObject | undefined} params - The resolved `@Params()` schema.
 * @return {ParameterObject[]} The parameters.
 */
function createPathParameters(
  template: PathTemplate,
  params: SchemaObject | undefined,
): ParameterObject[] {
  return template.parameters.map(({ name, pattern }) => {
    const property = params?.properties?.[name];

    return createParameter(
      name,
      "path",
      true,
      property ?? {
        type: "string",
        ...(pattern === undefined ? {} : { pattern }),
      },
    );
  });
}

/**
 * Creates the query parameters: one per property of an object schema. Other
 * schemas (e.g. a union of objects) describe the whole query string, as a
 * form-encoded `querystring` parameter.
 *
 * @param {ConvertedSchema | undefined} query - The `@Query()` schema.
 * @return {ParameterObject[]} The parameters.
 */
function createQueryParameters(
  query: ConvertedSchema | undefined,
): ParameterObject[] {
  if (query === undefined) {
    return [];
  }

  const { properties, required = [] } = query.resolved;

  if (query.resolved.type !== "object" || properties === undefined) {
    return [{
      name: "query",
      in: "querystring",
      content: {
        "application/x-www-form-urlencoded": { schema: query.schema },
      },
    }];
  }

  return Object.entries(properties).map(([name, property]) =>
    createParameter(name, "query", required.includes(name), property)
  );
}

/**
 * Creates the header parameters, one per property of an object
 * `@RequestHeaders()` schema; `Accept`, `Content-Type` and `Authorization`
 * are left out, as OpenAPI ignores them. Other schemas cannot be split into
 * headers and are not documented.
 *
 * @param {SchemaObject | undefined} headers - The resolved
 *   `@RequestHeaders()` schema.
 * @return {ParameterObject[]} The parameters.
 */
function createHeaderParameters(
  headers: SchemaObject | undefined,
): ParameterObject[] {
  if (headers?.type !== "object" || headers.properties === undefined) {
    return [];
  }

  const required = headers.required ?? [];

  return Object.entries(headers.properties)
    .filter(([name]) => !Object.hasOwn(IGNORED_HEADERS, name.toLowerCase()))
    .map(([name, property]) =>
      createParameter(name, "header", required.includes(name), property)
    );
}

/**
 * Creates the item schema of a server-sent event stream: the parsed event
 * fields, with one alternative per event name describing its `data`. Data of
 * string schemas is the schema itself, other data is JSON
 * (`contentMediaType` and `contentSchema`). The `message` alternative also
 * matches events without `event` field, which browsers dispatch as
 * `message`.
 *
 * @param {Record<string, ZodType>} events - Schema of the data by event name.
 * @param {SchemaCollector} schemas - Collects the schemas of the document.
 * @return {SchemaObject} The item schema.
 */
function createEventSchema(
  events: Record<string, ZodType>,
  schemas: SchemaCollector,
): SchemaObject {
  const alternatives = Object.entries(events).map(([name, zodSchema]) => {
    const { schema, resolved } = schemas.convert(zodSchema, "output");

    return {
      properties: {
        event: { const: name },
        data: resolved.type === "string" ? schema : {
          type: "string" as const,
          contentMediaType: "application/json",
          contentSchema: schema,
        },
      },
      ...(name === "message" ? {} : { required: ["event"] }),
    };
  });

  return {
    type: "object",
    properties: {
      event: { type: "string" },
      data: { type: "string" },
      id: { type: "string" },
      retry: { type: "integer", minimum: 0 },
    },
    required: ["data"],
    ...(alternatives.length > 0 ? { oneOf: alternatives } : {}),
  };
}

/**
 * Creates the servers of a host-restricted route: a network-path reference
 * (`//api.example.com`, same scheme as the documentation page) per host
 * name, and a server with a `{host}` variable per RegExp, which a URL cannot
 * express.
 *
 * @param {NonNullable<HttpRoute["host"]>} host - Host option of the
 *   controller.
 * @return {ServerObject[]} The servers.
 */
function createServers(host: NonNullable<HttpRoute["host"]>): ServerObject[] {
  return [host].flat().map((entry) =>
    typeof entry === "string" ? { url: `//${entry}` } : {
      url: "//{host}",
      description: `Hosts matching ${entry}`,
      variables: {
        host: { default: "", description: `A host matching ${entry}` },
      },
    }
  );
}

/**
 * Creates a documented response. Without `contentType`, item schemas are
 * `application/jsonl`, events `text/event-stream`, scalar schemas
 * `text/plain` (the way the HTTP adapter sends strings, numbers and
 * booleans) and other schemas `application/json`.
 *
 * @param {ApiResponseStatus} status - Status of the response.
 * @param {ApiResponseOptions} options - The `@ApiResponse()` options.
 * @param {SchemaCollector} schemas - Collects the schemas of the document.
 * @return {ResponseObject} The response.
 */
function createResponse(
  status: ApiResponseStatus,
  options: ApiResponseOptions,
  schemas: SchemaCollector,
): ResponseObject {
  const description = options.description ??
    (status === "default"
      ? "Default response"
      : STATUS_TEXT[status] ?? "Response");

  if (options.events !== undefined) {
    return {
      description,
      content: {
        [options.contentType ?? "text/event-stream"]: {
          itemSchema: createEventSchema(options.events, schemas),
        },
      },
    };
  }

  if (options.schema === undefined && options.itemSchema === undefined) {
    return { description };
  }

  const media: MediaTypeObject = {};
  let contentType = options.contentType;

  if (options.schema !== undefined) {
    const { schema, resolved } = schemas.convert(options.schema, "output");
    // Types of the schema or of every union member; "?" for untyped ones.
    const types = (resolved.anyOf ?? [resolved])
      .flatMap((variant) => [(variant as SchemaObject).type ?? "?"].flat())
      .filter((type) => type !== "null");

    media.schema = schema;
    contentType ??= options.itemSchema === undefined &&
        types.length > 0 &&
        types.every((type) => Object.hasOwn(TEXT_TYPES, type))
      ? "text/plain"
      : undefined;
  }

  if (options.itemSchema !== undefined) {
    media.itemSchema = schemas.convert(options.itemSchema, "output").schema;
    contentType ??= "application/jsonl";
  }

  return {
    description,
    content: { [contentType ?? "application/json"]: media },
  };
}

/**
 * Creates the responses of a route: the documented ones (route responses
 * replace controller responses), the success response of the framework
 * (`@HttpCode()`, `200` without one) unless a `1xx`-`3xx` response is
 * documented, `400` for routes validating input and `403` for guarded routes.
 *
 * @param {HttpRoute} route - The route.
 * @param {ApiMetadata} controller - Documentation of the controller.
 * @param {ApiMetadata} handler - Documentation of the route.
 * @param {SchemaCollector} schemas - Collects the schemas of the document.
 * @return {Record<string, ResponseObject>} The responses by status.
 */
function createResponses(
  route: HttpRoute,
  controller: ApiMetadata,
  handler: ApiMetadata,
  schemas: SchemaCollector,
): Record<string, ResponseObject> {
  const documented = new Map([...controller.responses, ...handler.responses]);
  const responses: Record<string, ResponseObject> = {};

  for (const [status, options] of documented) {
    responses[status] = createResponse(status, options, schemas);
  }

  if (
    ![...documented.keys()].some((status) =>
      status !== "default" && status < StatusCode.BadRequest
    )
  ) {
    const status = route.metadata.statusCode ?? StatusCode.Ok;

    responses[status] = { description: STATUS_TEXT[status] ?? "Response" };
  }

  const { validation, query, params, headers } = route.metadata;

  if (
    (validation !== undefined || query !== undefined ||
      params !== undefined || headers !== undefined) &&
    !documented.has(StatusCode.BadRequest)
  ) {
    responses[StatusCode.BadRequest] = {
      description: STATUS_TEXT[StatusCode.BadRequest],
    };
  }

  if (route.guards.length > 0 && !documented.has(StatusCode.Forbidden)) {
    responses[StatusCode.Forbidden] = {
      description: STATUS_TEXT[StatusCode.Forbidden],
    };
  }

  return responses;
}

/**
 * Creates the security requirements of a route. Every `@ApiSecurity()` of
 * the route's guards, its controller and the route itself is required; the
 * alternatives of each one are combined into the accepted alternatives.
 *
 * @param {HttpRoute} route - The route.
 * @param {ApiMetadata} controller - Documentation of the controller.
 * @param {ApiMetadata} handler - Documentation of the route.
 * @return {SecurityRequirementObject[] | undefined} The requirements, `[]`
 *   for a public route, `undefined` without any.
 */
function createSecurity(
  route: HttpRoute,
  controller: ApiMetadata,
  handler: ApiMetadata,
): SecurityRequirementObject[] | undefined {
  if (handler.public) {
    return [];
  }

  const required = controller.public ? handler.security : [
    ...route.guards.flatMap((guard) =>
      readClassMetadata(typeof guard === "function" ? guard : guard.constructor)
        ?.security ?? []
    ),
    ...controller.security,
    ...handler.security,
  ];

  if (required.length === 0) {
    return controller.public ? [] : undefined;
  }

  let combined: SecurityRequirementObject[] = [{}];

  for (const alternatives of required) {
    combined = combined.flatMap((requirement) =>
      alternatives.map((alternative) => {
        const merged = { ...requirement };

        for (const [name, scopes] of Object.entries(alternative)) {
          merged[name] = [...new Set([...merged[name] ?? [], ...scopes])];
        }

        return merged;
      })
    );
  }

  const unique = new Map<string, SecurityRequirementObject>();

  for (const requirement of combined) {
    unique.set(
      JSON.stringify(
        Object.entries(requirement).sort(([a], [b]) => a < b ? -1 : 1),
      ),
      requirement,
    );
  }

  return [...unique.values()];
}

/**
 * Converts the body, query and path parameter schemas of a route.
 *
 * @param {HttpRoute} route - The route.
 * @param {ApiRouteMetadata} handler - Documentation of the route.
 * @param {SchemaCollector} schemas - Collects the schemas of the document.
 * @return {RouteSchemas} The converted schemas.
 */
function convertRouteSchemas(
  route: HttpRoute,
  handler: ApiRouteMetadata,
  schemas: SchemaCollector,
): RouteSchemas {
  const { params, query, headers, validation } = route.metadata;
  let requestBody = handler.operation.requestBody;

  if (requestBody === undefined && validation !== undefined) {
    const { schema } = schemas.convert(validation.dto, "input");

    requestBody = {
      required: true,
      content: validation.type === "json"
        ? { "application/json": { schema } }
        : {
          "multipart/form-data": { schema },
          "application/x-www-form-urlencoded": { schema },
        },
    };
  }

  return {
    params: params === undefined
      ? undefined
      : schemas.convert(params, "input").resolved,
    query: query === undefined ? undefined : schemas.convert(query, "input"),
    headers: headers === undefined
      ? undefined
      : schemas.convert(headers, "input").resolved,
    requestBody,
  };
}

/**
 * Creates the OpenAPI document of the registered routes.
 *
 * Routes of excluded controllers and excluded routes are left out, and so
 * are routes of controllers with an empty `host` list, which serve no host.
 * When several routes share a method and path, the first registered one is
 * documented, since it answers the requests.
 *
 * @param {readonly HttpRoute[]} routes - The registered routes.
 * @param {OpenApiDocumentOptions} options - Top-level document fields.
 * @return {OpenAPIObject} The document.
 * @throws {Error} When a route requires a security scheme the options do not
 *   define, or when schema names collide.
 */
export function createDocument(
  routes: readonly HttpRoute[],
  options: OpenApiDocumentOptions,
): OpenAPIObject {
  const schemas = new SchemaCollector();
  const paths: Record<string, PathItemObject> = {};
  const operationIds = new Set<string>();
  const securitySchemes = options.components?.securitySchemes ?? {};

  for (const route of routes) {
    const controller = readClassMetadata(route.controller) ?? NO_METADATA;
    const handler = readRouteMetadata(route.controller, route.metadata.name) ??
      NO_METADATA;

    if (
      controller.exclude || handler.exclude ||
      (Array.isArray(route.host) && route.host.length === 0)
    ) {
      continue;
    }

    const method = OPERATION_METHODS[route.method];
    const templates = toPathTemplates(route.path).filter((template) =>
      paths[template.path]?.[method] === undefined
    );

    if (templates.length === 0) {
      continue;
    }

    const routeSchemas = convertRouteSchemas(route, handler, schemas);
    const tags = [...new Set([...controller.tags, ...handler.tags])];
    const { summary, description, externalDocs, deprecated } =
      handler.operation;
    const name = route.metadata.name;
    const baseId = handler.operation.operationId ??
      `${route.controller.name}_${
        typeof name === "symbol" ? name.description : name
      }`;
    const security = createSecurity(route, controller, handler);
    const servers = route.host === undefined
      ? undefined
      : createServers(route.host);

    for (const requirement of security ?? []) {
      for (const scheme of Object.keys(requirement)) {
        if (
          !SCHEME_URI.test(scheme) && !Object.hasOwn(securitySchemes, scheme)
        ) {
          throw new Error(
            `The route ${HttpMethod[route.method]} ${route.path} requires ` +
              `the security scheme "${scheme}" (@ApiSecurity()), which ` +
              "document.components.securitySchemes does not define.",
          );
        }
      }
    }

    for (const template of templates) {
      let operationId = baseId;

      for (let count = 2; operationIds.has(operationId); count++) {
        operationId = `${baseId}_${count}`;
      }

      operationIds.add(operationId);

      const parameters = [
        ...createPathParameters(template, routeSchemas.params),
        ...createQueryParameters(routeSchemas.query),
        ...createHeaderParameters(routeSchemas.headers),
      ];
      const operation: OperationObject = {
        ...(tags.length > 0 ? { tags } : {}),
        ...(summary === undefined ? {} : { summary }),
        ...(description === undefined ? {} : { description }),
        ...(externalDocs === undefined ? {} : { externalDocs }),
        operationId,
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(routeSchemas.requestBody === undefined
          ? {}
          : { requestBody: routeSchemas.requestBody }),
        responses: createResponses(route, controller, handler, schemas),
        ...(deprecated === undefined ? {} : { deprecated }),
        ...(security === undefined ? {} : { security }),
        ...(servers === undefined ? {} : { servers }),
      };

      (paths[template.path] ??= {})[method] = operation;
    }
  }

  const components: ComponentsObject = { ...options.components };
  const generated = schemas.finalize(
    paths,
    Object.keys(components.schemas ?? {}),
  );

  if (Object.keys(generated).length > 0) {
    components.schemas = { ...components.schemas, ...generated };
  }

  return {
    openapi: OPENAPI_VERSION,
    ...options,
    paths,
    ...(Object.keys(components).length > 0 ? { components } : {}),
  };
}
