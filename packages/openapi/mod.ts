/**
 * OpenAPI 3.2 documentation for denorid HTTP applications, in the spirit of
 * `@nestjs/swagger`: the document is generated from what the routes already
 * declare (paths, methods, `@Body()`, `@Form()`, `@Query()` and `@Params()`
 * zod schemas, `@HttpCode()`, guards), completed by a few decorators for
 * what the framework cannot know (responses, tags, security).
 *
 * Zod schemas with an `id` (`.meta({ id: "User" })`) become reusable
 * `components.schemas`; `.describe()` and `.meta()` fields end up in the
 * document.
 *
 * @example
 * ```ts
 * import { Body, Controller, Get, Params, Post, Query } from "@denorid/core";
 * import { ApiResponse, ApiTags, OpenApiModule } from "@denorid/openapi";
 * import { z } from "zod";
 *
 * const Thread = z.object({ id: z.uuid(), title: z.string() })
 *   .meta({ id: "Thread" });
 *
 * \@ApiTags("threads")
 * \@Controller("/threads")
 * class ThreadController {
 *   \@Get("/:id")
 *   \@Params(z.object({ id: z.uuid() }))
 *   \@ApiResponse(200, { schema: Thread })
 *   public findOne(ctx: RequestContext): Promise<z.infer<typeof Thread>> {}
 * }
 *
 * \@Module({
 *   imports: [
 *     OpenApiModule.forRoot({
 *       document: { info: { title: "Forum API", version: "1.0.0" } },
 *     }),
 *   ],
 *   providers: [ThreadController],
 * })
 * class AppModule {}
 * ```
 *
 * @module
 */

export * from "./decorators.ts";
export * from "./module.ts";
export * from "./module_options.ts";
export * from "./service.ts";
export * from "./types.ts";
