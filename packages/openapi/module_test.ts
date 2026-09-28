import {
  Controller,
  ControllerMapping,
  type ControllerMappingOptions,
  DenoridFactory,
  Get,
  type HttpAdapter,
  type HttpApplicationContext,
  type HttpController,
  HttpRoutes,
  Params,
} from "@denorid/core";
import { Injectable, Module, type Type } from "@denorid/injector";
import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { describe, it } from "node:test";
import { z } from "zod";
import { ApiResponse, ApiTags } from "./decorators.ts";
import { OpenApiModule } from "./module.ts";
import type { OpenApiModuleOptions } from "./module_options.ts";
import { OpenApiService } from "./service.ts";

/** Registers nothing: core records the routes. */
class RecordingControllerMapping extends ControllerMapping {
  protected override registerRoute(): Promise<void> {
    return Promise.resolve();
  }
}

const adapter: HttpAdapter = {
  listen: (): void => {},
  close: (): Promise<void> => Promise.resolve(),
  createControllerMapping: (
    options: ControllerMappingOptions,
  ): ControllerMapping => new RecordingControllerMapping(options),
};

const Thread = z.object({ id: z.uuid(), title: z.string() }).meta({
  id: "ModuleThread",
});

@ApiTags("threads")
@Controller("/threads")
class ThreadController {
  @Get("/:id")
  @Params(z.object({ id: z.uuid() }))
  @ApiResponse(200, { schema: Thread })
  public find(): void {}
}

async function createApp(
  options: Partial<OpenApiModuleOptions> = {},
): Promise<HttpApplicationContext> {
  @Module({
    imports: [
      OpenApiModule.forRoot({
        document: { info: { title: "Forum & <API>", version: "1.0.0" } },
        ...options,
      }),
    ],
    providers: [ThreadController],
  })
  class AppModule {}

  return await DenoridFactory.create(AppModule, adapter, { basePath: "/api" });
}

async function callRoute(
  app: HttpApplicationContext,
  path: string,
): Promise<unknown> {
  const route = (await app.get(HttpRoutes, { strict: false })).list().find((
    route,
  ) => route.path === path);

  if (route === undefined) {
    return undefined;
  }

  const controller = await app.get(route.controller as Type<HttpController>, {
    strict: false,
  });

  return await controller[route.metadata.name](undefined as never);
}

describe("OpenApiModule", () => {
  it("documents the routes without initializing the application", async () => {
    const app = await createApp();

    try {
      const openApi = await app.get(OpenApiService, { strict: false });
      const document = openApi.getDocument();

      assertStrictEquals(openApi.getDocument(), document);
      assertEquals(Object.keys(document.paths ?? {}), ["/api/threads/{id}"]);
      assertEquals(document.paths?.["/api/threads/{id}"]?.get?.tags, [
        "threads",
      ]);
      assertEquals(Object.keys(document.components?.schemas ?? {}), [
        "ModuleThread",
      ]);

      app.useGlobalGuards((): boolean => true);

      const guarded = openApi.getDocument();

      assertEquals(
        Object.keys(guarded.paths?.["/api/threads/{id}"]?.get?.responses ?? {}),
        ["200", "400", "403"],
      );

      await app.init();

      assertEquals(openApi.getDocument(), guarded);
    } finally {
      await app.close();
    }
  });

  it("serves the document and Swagger UI under the base path", async () => {
    const app = await createApp();

    try {
      await app.init();

      assertStrictEquals(
        await callRoute(app, "/api/docs/openapi.json"),
        (await app.get(OpenApiService, { strict: false })).getDocument(),
      );

      const page = await callRoute(app, "/api/docs") as Response;
      const html = await page.text();

      assertEquals(
        page.headers.get("Content-Type"),
        "text/html; charset=utf-8",
      );
      assertStringIncludes(html, "<title>Forum &amp; &lt;API&gt;</title>");
      assertStringIncludes(
        html,
        'integrity="sha384-YDALVcy8kj8yltLBVi1vBiBAUqdxvus673gM8XKwiy6aDUJFXivF/KCufekjYbVf"',
      );
      assertStringIncludes(
        html,
        'location.pathname.replace(/\\/?$/, "/openapi.json")',
      );
    } finally {
      await app.close();
    }
  });

  it("serves the document at a custom path, without UI", async () => {
    const app = await createApp({ path: "/reference", ui: false });

    try {
      await app.init();

      const paths = (await app.get(HttpRoutes, { strict: false })).list().map((
        { path },
      ) => path);

      assertEquals(paths.includes("/api/reference/openapi.json"), true);
      assertEquals(paths.includes("/api/reference"), false);
    } finally {
      await app.close();
    }
  });

  it("creates the document fields with the forRootAsync() factory", async () => {
    @Injectable()
    class VersionService {
      public readonly version = "2.1.0";
    }

    @Module({ providers: [VersionService], exports: [VersionService] })
    class VersionModule {}

    @Module({
      imports: [
        OpenApiModule.forRootAsync({
          imports: [VersionModule],
          inject: [VersionService],
          useFactory: (versions: VersionService) =>
            Promise.resolve({
              info: { title: "Async <API>", version: versions.version },
            }),
        }),
      ],
      providers: [ThreadController],
    })
    class AsyncModule {}

    const app = await DenoridFactory.create(AsyncModule, adapter, {
      basePath: "/api",
    });

    try {
      await app.init();

      const document = (await app.get(OpenApiService, { strict: false }))
        .getDocument();
      const page = await callRoute(app, "/api/docs") as Response;

      assertEquals(document.info, { title: "Async <API>", version: "2.1.0" });
      assertEquals(Object.keys(document.paths ?? {}), ["/api/threads/{id}"]);
      assertStringIncludes(
        await page.text(),
        "<title>Async &lt;API&gt;</title>",
      );
    } finally {
      await app.close();
    }
  });

  it("applies path and ui to forRootAsync()", async () => {
    @Module({
      imports: [
        OpenApiModule.forRootAsync({
          path: "reference",
          ui: false,
          useFactory: () => ({ info: { title: "API", version: "1" } }),
        }),
      ],
    })
    class AsyncModule {}

    const app = await DenoridFactory.create(AsyncModule, adapter);

    try {
      await app.init();

      assertEquals(
        (await app.get(HttpRoutes, { strict: false })).list().map((
          { path },
        ) => path),
        ["/reference/openapi.json"],
      );
      assertEquals(
        (await callRoute(app, "/reference/openapi.json") as {
          info: unknown;
        }).info,
        { title: "API", version: "1" },
      );
    } finally {
      await app.close();
    }
  });
});
