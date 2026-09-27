import type { JSONSchema } from "zod/v4/core";

/**
 * A JSON Schema (draft 2020-12), the schema dialect of OpenAPI 3.2.
 */
export type SchemaObject = JSONSchema.JSONSchema;

/** A reference to a component of the document, e.g. `#/components/schemas/User`. */
export interface ReferenceObject {
  /** URI of the referenced component. */
  $ref: string;
  /** Overrides the summary of the referenced component. */
  summary?: string;
  /** Overrides the description of the referenced component. */
  description?: string;
}

/** Contact information of the API. */
export interface ContactObject {
  /** Name of the contact person or organization. */
  name?: string;
  /** URL of the contact information. */
  url?: string;
  /** Email address of the contact. */
  email?: string;
}

/** License of the API. */
export interface LicenseObject {
  /** License name, e.g. `MIT`. */
  name: string;
  /** SPDX license expression; excludes `url`. */
  identifier?: string;
  /** URL of the license; excludes `identifier`. */
  url?: string;
}

/** Metadata about the API. */
export interface InfoObject {
  /** Title of the API. */
  title: string;
  /** Short summary of the API. */
  summary?: string;
  /** Description of the API; CommonMark is allowed. */
  description?: string;
  /** URL of the terms of service. */
  termsOfService?: string;
  /** Contact information. */
  contact?: ContactObject;
  /** License information. */
  license?: LicenseObject;
  /** Version of the API (not of the OpenAPI specification). */
  version: string;
}

/** A variable substituted in a server URL template. */
export interface ServerVariableObject {
  /** Allowed values. */
  enum?: string[];
  /** Value used when none is given. */
  default: string;
  /** Description of the variable. */
  description?: string;
}

/** A server hosting the API. */
export interface ServerObject {
  /** URL of the server, may be relative and contain `{variables}`. */
  url: string;
  /** Short name of the server, e.g. `Production`. */
  name?: string;
  /** Description of the server. */
  description?: string;
  /** Values of the variables in `url`. */
  variables?: Record<string, ServerVariableObject>;
}

/** Link to external documentation. */
export interface ExternalDocumentationObject {
  /** Description of the documentation. */
  description?: string;
  /** URL of the documentation. */
  url: string;
}

/** Metadata of a tag used by operations. */
export interface TagObject {
  /** Name of the tag. */
  name: string;
  /** Short summary of the tag, shown in lists of tags. */
  summary?: string;
  /** Description of the tag. */
  description?: string;
  /** Additional external documentation. */
  externalDocs?: ExternalDocumentationObject;
  /** Name of the tag this tag is nested under. */
  parent?: string;
  /** Category of the tag, e.g. `nav`, `badge` or `audience`. */
  kind?: string;
}

/** An example value. */
export interface ExampleObject {
  /** Short summary of the example. */
  summary?: string;
  /** Long description of the example. */
  description?: string;
  /** The example as data, before serialization. */
  dataValue?: unknown;
  /** The example serialized as it is sent, e.g. a JSON string. */
  serializedValue?: string;
  /** URL of the serialized example; excludes the other values. */
  externalValue?: string;
  /** The example value; prefer `dataValue` and `serializedValue`. */
  value?: unknown;
}

/** A header of a response or of a multipart part. */
export interface HeaderObject {
  /** Description of the header. */
  description?: string;
  /** Whether the header is required. */
  required?: boolean;
  /** Whether the header is deprecated. */
  deprecated?: boolean;
  /** Schema of the header value; excludes `content`. */
  schema?: SchemaObject | ReferenceObject;
  /** Representation of the header value by media type; excludes `schema`. */
  content?: Record<string, MediaTypeObject | ReferenceObject>;
}

/** Encoding of a property or item of a `multipart` or form body. */
export interface EncodingObject {
  /** Content type of the property. */
  contentType?: string;
  /** Headers of the part. */
  headers?: Record<string, HeaderObject | ReferenceObject>;
  /** Serialization style of the property. */
  style?: string;
  /** Whether arrays and objects generate separate parameters. */
  explode?: boolean;
  /** Whether reserved characters are sent without percent-encoding. */
  allowReserved?: boolean;
  /** Encoding of the properties of a nested `multipart` part. */
  encoding?: Record<string, EncodingObject>;
  /** Encoding of the leading items of a nested `multipart` part. */
  prefixEncoding?: EncodingObject[];
  /** Encoding of the remaining items of a nested `multipart` part. */
  itemEncoding?: EncodingObject;
}

/** Schema and examples of one media type. */
export interface MediaTypeObject {
  /** Schema of the complete content. */
  schema?: SchemaObject | ReferenceObject;
  /**
   * Schema of every item of a sequential media type, e.g. the events of
   * `text/event-stream` or the lines of `application/jsonl`.
   */
  itemSchema?: SchemaObject | ReferenceObject;
  /** Example of the content. */
  example?: unknown;
  /** Named examples of the content. */
  examples?: Record<string, ExampleObject | ReferenceObject>;
  /** Encoding of the properties, for `multipart` and form bodies. */
  encoding?: Record<string, EncodingObject>;
  /** Encoding of the leading parts of a positional `multipart` body. */
  prefixEncoding?: EncodingObject[];
  /** Encoding of the remaining parts of a positional `multipart` body. */
  itemEncoding?: EncodingObject;
}

/**
 * Location of a parameter; `querystring` describes the whole query string as
 * one value (with `content`).
 */
export type ParameterLocation =
  | "query"
  | "querystring"
  | "header"
  | "path"
  | "cookie";

/** A parameter of an operation. */
export interface ParameterObject {
  /** Name of the parameter, case-sensitive; unused for `querystring`. */
  name: string;
  /** Location of the parameter. */
  in: ParameterLocation;
  /** Description of the parameter. */
  description?: string;
  /** Whether the parameter is required; always `true` for path parameters. */
  required?: boolean;
  /** Whether the parameter is deprecated. */
  deprecated?: boolean;
  /** Whether an empty value may be sent (query parameters). */
  allowEmptyValue?: boolean;
  /** Serialization style of the value; not with `content`. */
  style?: string;
  /** Whether arrays and objects generate separate parameters. */
  explode?: boolean;
  /** Whether reserved characters are sent without percent-encoding. */
  allowReserved?: boolean;
  /** Schema of the value; excludes `content`, not for `querystring`. */
  schema?: SchemaObject | ReferenceObject;
  /** Representation of the value by media type; required for `querystring`. */
  content?: Record<string, MediaTypeObject | ReferenceObject>;
  /** Example of the value. */
  example?: unknown;
  /** Named examples of the value. */
  examples?: Record<string, ExampleObject | ReferenceObject>;
}

/** The request body of an operation. */
export interface RequestBodyObject {
  /** Description of the body. */
  description?: string;
  /** Content of the body by media type, e.g. `application/json`. */
  content: Record<string, MediaTypeObject | ReferenceObject>;
  /** Whether the body is required. */
  required?: boolean;
}

/** A response of an operation. */
export interface ResponseObject {
  /** Short summary of the response. */
  summary?: string;
  /** Description of the response. */
  description?: string;
  /** Headers of the response. */
  headers?: Record<string, HeaderObject | ReferenceObject>;
  /** Content of the response by media type; none for an empty body. */
  content?: Record<string, MediaTypeObject | ReferenceObject>;
}

/**
 * Security schemes required by an operation: every scheme of one object is
 * required together, each object of a list is an alternative. Keys are
 * names of `components.securitySchemes` or URIs of security schemes.
 */
export type SecurityRequirementObject = Record<string, string[]>;

/** An OAuth 2.0 flow. */
export interface OAuthFlowObject {
  /** Authorization URL (implicit, authorization code). */
  authorizationUrl?: string;
  /** Device authorization URL (device authorization). */
  deviceAuthorizationUrl?: string;
  /** Token URL (password, client credentials, authorization code, device). */
  tokenUrl?: string;
  /** URL to obtain refresh tokens. */
  refreshUrl?: string;
  /** Available scopes with their description. */
  scopes: Record<string, string>;
}

/** The OAuth 2.0 flows of a security scheme. */
export interface OAuthFlowsObject {
  /** Implicit flow. */
  implicit?: OAuthFlowObject;
  /** Resource owner password flow. */
  password?: OAuthFlowObject;
  /** Client credentials flow. */
  clientCredentials?: OAuthFlowObject;
  /** Authorization code flow. */
  authorizationCode?: OAuthFlowObject;
  /** Device authorization flow (RFC 8628). */
  deviceAuthorization?: OAuthFlowObject;
}

/** Fields shared by every security scheme. */
export interface BaseSecuritySchemeObject {
  /** Description of the scheme. */
  description?: string;
  /** Whether the scheme is still supported but should not be used anymore. */
  deprecated?: boolean;
}

/** An API key sent in a header, query parameter or cookie. */
export interface ApiKeySecuritySchemeObject extends BaseSecuritySchemeObject {
  /** Scheme type. */
  type: "apiKey";
  /** Name of the header, query parameter or cookie. */
  name: string;
  /** Location of the key. */
  in: "query" | "header" | "cookie";
}

/** HTTP authentication, e.g. `bearer` or `basic`. */
export interface HttpSecuritySchemeObject extends BaseSecuritySchemeObject {
  /** Scheme type. */
  type: "http";
  /** Authorization scheme, e.g. `bearer`. */
  scheme: string;
  /** Format of a bearer token, e.g. `JWT`. */
  bearerFormat?: string;
}

/** Mutual TLS authentication. */
export interface MutualTlsSecuritySchemeObject
  extends BaseSecuritySchemeObject {
  /** Scheme type. */
  type: "mutualTLS";
}

/** OAuth 2.0 authentication. */
export interface OAuth2SecuritySchemeObject extends BaseSecuritySchemeObject {
  /** Scheme type. */
  type: "oauth2";
  /** The supported flows. */
  flows: OAuthFlowsObject;
  /** URL of the authorization server metadata (RFC 8414). */
  oauth2MetadataUrl?: string;
}

/** OpenID Connect authentication. */
export interface OpenIdConnectSecuritySchemeObject
  extends BaseSecuritySchemeObject {
  /** Scheme type. */
  type: "openIdConnect";
  /** URL of the OpenID Connect discovery document. */
  openIdConnectUrl: string;
}

/** A security scheme usable by operations. */
export type SecuritySchemeObject =
  | ApiKeySecuritySchemeObject
  | HttpSecuritySchemeObject
  | MutualTlsSecuritySchemeObject
  | OAuth2SecuritySchemeObject
  | OpenIdConnectSecuritySchemeObject;

/** An API operation: one method on one path. */
export interface OperationObject {
  /** Tags grouping the operation. */
  tags?: string[];
  /** Short summary of the operation. */
  summary?: string;
  /** Description of the operation; CommonMark is allowed. */
  description?: string;
  /** Additional external documentation. */
  externalDocs?: ExternalDocumentationObject;
  /** Unique id of the operation, e.g. used as function name by generators. */
  operationId?: string;
  /** Parameters of the operation. */
  parameters?: (ParameterObject | ReferenceObject)[];
  /** Request body of the operation. */
  requestBody?: RequestBodyObject | ReferenceObject;
  /** Responses by status code (or `default`). */
  responses?: Record<string, ResponseObject | ReferenceObject>;
  /** Whether the operation is deprecated. */
  deprecated?: boolean;
  /** Security requirements; an empty list means no authentication. */
  security?: SecurityRequirementObject[];
  /** Servers overriding the document servers. */
  servers?: ServerObject[];
}

/** The operations available on one path. */
export interface PathItemObject {
  /** Reference to a path item defined elsewhere. */
  $ref?: string;
  /** Short summary of the path. */
  summary?: string;
  /** Description of the path. */
  description?: string;
  /** `GET` operation. */
  get?: OperationObject;
  /** `PUT` operation. */
  put?: OperationObject;
  /** `POST` operation. */
  post?: OperationObject;
  /** `DELETE` operation. */
  delete?: OperationObject;
  /** `OPTIONS` operation. */
  options?: OperationObject;
  /** `HEAD` operation. */
  head?: OperationObject;
  /** `PATCH` operation. */
  patch?: OperationObject;
  /** `TRACE` operation. */
  trace?: OperationObject;
  /** `QUERY` operation. */
  query?: OperationObject;
  /** Operations of other methods, by method name as sent, e.g. `LINK`. */
  additionalOperations?: Record<string, OperationObject>;
  /** Servers overriding the document servers. */
  servers?: ServerObject[];
  /** Parameters shared by every operation of the path. */
  parameters?: (ParameterObject | ReferenceObject)[];
}

/** Reusable objects of the document. */
export interface ComponentsObject {
  /** Schemas by name. */
  schemas?: Record<string, SchemaObject>;
  /** Responses by name. */
  responses?: Record<string, ResponseObject | ReferenceObject>;
  /** Parameters by name. */
  parameters?: Record<string, ParameterObject | ReferenceObject>;
  /** Examples by name. */
  examples?: Record<string, ExampleObject | ReferenceObject>;
  /** Request bodies by name. */
  requestBodies?: Record<string, RequestBodyObject | ReferenceObject>;
  /** Headers by name. */
  headers?: Record<string, HeaderObject | ReferenceObject>;
  /** Security schemes by name, referenced by security requirements. */
  securitySchemes?: Record<string, SecuritySchemeObject | ReferenceObject>;
  /** Path items by name. */
  pathItems?: Record<string, PathItemObject>;
  /** Media types by name. */
  mediaTypes?: Record<string, MediaTypeObject | ReferenceObject>;
}

/** The root object of an OpenAPI 3.2 document. */
export interface OpenAPIObject {
  /** Version of the OpenAPI specification. */
  openapi: string;
  /** URI of the document, the base of its relative references. */
  $self?: string;
  /** Metadata about the API. */
  info: InfoObject;
  /** Default JSON Schema dialect of the schemas. */
  jsonSchemaDialect?: string;
  /** Servers hosting the API; `/` when omitted. */
  servers?: ServerObject[];
  /** The operations by path. */
  paths?: Record<string, PathItemObject>;
  /** Requests the API may send to its clients, by name. */
  webhooks?: Record<string, PathItemObject>;
  /** Reusable objects. */
  components?: ComponentsObject;
  /** Security requirements of every operation without its own. */
  security?: SecurityRequirementObject[];
  /** Tags with their metadata. */
  tags?: TagObject[];
  /** Additional external documentation. */
  externalDocs?: ExternalDocumentationObject;
}
