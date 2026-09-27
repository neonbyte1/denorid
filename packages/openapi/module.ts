import { Controller, Get } from "@denorid/core";
import {
  type DynamicModule,
  type FactoryProvider,
  Inject,
  Module,
  type Provider,
  type ValueProvider,
} from "@denorid/injector";
import { OPENAPI_DOCUMENT_OPTIONS } from "./_constants.ts";
import { createSwaggerUiPage } from "./_swagger_ui.ts";
import { ApiExclude } from "./decorators.ts";
import type {
  OpenApiAsyncModuleOptions,
  OpenApiDocumentOptions,
  OpenApiModuleOptions,
} from "./module_options.ts";
import { OpenApiService } from "./service.ts";
import type { OpenAPIObject } from "./types.ts";

/**
 * Serves the OpenAPI document of the application and Swagger UI.
 *
 * The document is generated from the registered routes: paths and methods,
 * `@Body()`, `@Form()`, `@Query()`, `@Params()` and `@RequestHeaders()`
 * schemas, `@HttpCode()`, guards, controller hosts, and the `@Api*()`
 * decorators of this package.
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
    return this.createDynamicModule(options, [], {
      provide: OPENAPI_DOCUMENT_OPTIONS,
      useValue: options.document,
    });
  }

  /**
   * Registers the documentation routes like {@link forRoot}, with the
   * document fields created by a factory.
   *
   * @example
   * ```ts
   * OpenApiModule.forRootAsync({
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: (config: ConfigService) => ({
   *     info: { title: "Forum API", version: config.get("VERSION") },
   *   }),
   * });
   * ```
   *
   * @param {OpenApiAsyncModuleOptions} options - Path, UI and the factory of
   *   the document fields.
   * @return {DynamicModule} The configured dynamic module.
   */
  public static forRootAsync(
    options: OpenApiAsyncModuleOptions,
  ): DynamicModule {
    return this.createDynamicModule(options, options.imports ?? [], {
      provide: OPENAPI_DOCUMENT_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    });
  }

  /**
   * Creates the documentation controllers and the dynamic module.
   *
   * @param {Omit<OpenApiModuleOptions, "document">} options - Path and UI.
   * @param {Required<DynamicModule>["imports"]} imports - Modules the
   *   document factory needs.
   * @param {ValueProvider | FactoryProvider} documentProvider - Provides the
   *   document fields.
   * @return {DynamicModule} The dynamic module.
   */
  private static createDynamicModule(
    options: Omit<OpenApiModuleOptions, "document">,
    imports: Required<DynamicModule>["imports"],
    documentProvider: ValueProvider | FactoryProvider,
  ): DynamicModule {
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
      documentProvider,
      OpenApiService,
      OpenApiDocumentController,
    ];

    if (options.ui !== false) {
      @ApiExclude()
      @Controller(path)
      class SwaggerUiController {
        @Inject(OPENAPI_DOCUMENT_OPTIONS)
        private readonly document!: OpenApiDocumentOptions;

        #page?: string;

        /**
         * @return {Response} The Swagger UI page.
         */
        @Get()
        public page(): Response {
          this.#page ??= createSwaggerUiPage(this.document.info.title);

          return new Response(this.#page, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      providers.push(SwaggerUiController);
    }

    return {
      module: OpenApiModule,
      imports,
      providers,
      exports: [OpenApiService],
    };
  }
}
