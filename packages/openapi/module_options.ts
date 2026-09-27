import type { OpenAPIObject } from "./types.ts";

/**
 * Top-level fields of the generated document. `openapi` and `paths` are
 * generated; `components.schemas` is extended with the schemas of the routes.
 */
export type OpenApiDocumentOptions = Omit<OpenAPIObject, "openapi" | "paths">;

/** Options of {@linkcode OpenApiModule.forRoot}. */
export interface OpenApiModuleOptions {
  /**
   * Path of the documentation, relative to the application base path like
   * every controller path: Swagger UI at `<path>`, the document at
   * `<path>/openapi.json`.
   *
   * @default "docs"
   */
  path?: string;
  /**
   * Top-level fields of the document: `info` (required), `servers`, `tags`,
   * `security`, `externalDocs` and `components`, e.g. the
   * `securitySchemes` referenced by `@ApiSecurity()`.
   */
  document: OpenApiDocumentOptions;
  /**
   * Serves Swagger UI at `path`. The page loads Swagger UI from the jsDelivr
   * CDN, pinned and checked with subresource integrity.
   *
   * @default true
   */
  ui?: boolean;
}
