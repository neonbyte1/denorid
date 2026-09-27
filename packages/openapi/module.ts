import { Controller, Get } from "@denorid/core";
import {
  type DynamicModule,
  Inject,
  Module,
  type Provider,
} from "@denorid/injector";
import { OPENAPI_MODULE_OPTIONS } from "./_constants.ts";
import { createSwaggerUiPage } from "./_swagger_ui.ts";
import { ApiExclude } from "./decorators.ts";
import type { OpenApiModuleOptions } from "./module_options.ts";
import { OpenApiService } from "./service.ts";
import type { OpenAPIObject } from "./types.ts";

/**
 * Serves the OpenAPI document of the application and Swagger UI.
 *
 * The document is generated from the registered routes: paths and methods,
 * `@Body()`, `@Form()`, `@Query()` and `@Params()` schemas, `@HttpCode()`,
 * guards, and the `@Api*()` decorators of this package.
 *
 * @example
 * ```ts
 * \@Module({
 *   imports: [
 *     OpenApiModule.forRoot({
 *       document: {
 *         info: { title: "Forum API", version: "1.0.0" },
 *         components: {
 *           securitySchemes: {
 *             bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
 *           },
 *         },
 *       },
 *     }),
 *   ],
 *   providers: [ForumController],
 * })
 * class AppModule {}
 * ```
 */
@Module({})
export class OpenApiModule {
  /**
   * Registers the documentation routes, `GET <path>` (Swagger UI) and
   * `GET <path>/openapi.json`, and exports {@linkcode OpenApiService}. The
   * routes are left out of the document.
   *
   * @param {OpenApiModuleOptions} options - Path, document fields and UI.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRoot(options: OpenApiModuleOptions): DynamicModule {
    const path = options.path ?? "docs";

    @ApiExclude()
    @Controller(path)
    class OpenApiDocumentController {
      @Inject(OpenApiService)
      private readonly openApi!: OpenApiService;

      /**
       * @return {OpenAPIObject} The OpenAPI document.
       */
      @Get("openapi.json")
      public document(): OpenAPIObject {
        return this.openApi.getDocument();
      }
    }

    const providers: Provider[] = [
      { provide: OPENAPI_MODULE_OPTIONS, useValue: options },
      OpenApiService,
      OpenApiDocumentController,
    ];

    if (options.ui !== false) {
      const page = createSwaggerUiPage(options.document.info.title);

      @ApiExclude()
      @Controller(path)
      class SwaggerUiController {
        /**
         * @return {Response} The Swagger UI page.
         */
        @Get()
        public page(): Response {
          return new Response(page, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      providers.push(SwaggerUiController);
    }

    return {
      module: OpenApiModule,
      providers,
      exports: [OpenApiService],
    };
  }
}
