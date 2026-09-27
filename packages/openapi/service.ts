import { type HttpRoute, HttpRoutes } from "@denorid/core";
import { Inject, Injectable } from "@denorid/injector";
import { OPENAPI_DOCUMENT_OPTIONS } from "./_constants.ts";
import { createDocument } from "./_document.ts";
import type { OpenApiDocumentOptions } from "./module_options.ts";
import type { OpenAPIObject } from "./types.ts";

/**
 * Generates the OpenAPI document of the application from its registered
 * routes, provided by {@linkcode OpenApiModule}.
 *
 * @example Writing the document to a file, e.g. for client generators
 * ```ts
 * const app = await DenoridFactory.create(AppModule, new HonoAdapter());
 * await app.init();
 *
 * const openApi = await app.get(OpenApiService, { strict: false });
 * await Deno.writeTextFile(
 *   "openapi.json",
 *   JSON.stringify(openApi.getDocument(), null, 2),
 * );
 * await app.close();
 * ```
 */
@Injectable()
export class OpenApiService {
  @Inject(HttpRoutes)
  private readonly routes!: HttpRoutes;

  @Inject(OPENAPI_DOCUMENT_OPTIONS)
  private readonly options!: OpenApiDocumentOptions;

  #cache?: { routes: readonly HttpRoute[]; document: OpenAPIObject };

  /**
   * Returns the document of the registered routes. It is created on the first
   * call and again once the application registered its routes anew. Routes
   * are registered while the application initializes: before, the document
   * has no paths.
   *
   * @return {OpenAPIObject} The document; do not modify it.
   * @throws {Error} When a route requires a security scheme the module
   *   options do not define, or when schema names collide.
   */
  public getDocument(): OpenAPIObject {
    const routes = this.routes.list();

    if (this.#cache?.routes !== routes) {
      this.#cache = {
        routes,
        document: createDocument(routes, this.options),
      };
    }

    return this.#cache.document;
  }
}
