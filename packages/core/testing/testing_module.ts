import type {
  InjectionToken,
  InjectorContext,
  ModuleRefContextOptions,
  ModuleRefOptions,
  Tag,
} from "@denorid/injector";
import type { ApplicationContext } from "../application_context.ts";

/**
 * A compiled test module that provides access to the DI container without export restrictions.
 *
 * Obtained by calling {@linkcode TestingModuleBuilder.compile}.
 */
export class TestingModule implements ApplicationContext {
  public constructor(private readonly ctx: InjectorContext) {}

  /**
   * @inheritdoc
   */
  public get<T>(
    token: InjectionToken<T>,
    options?: ModuleRefOptions,
  ): Promise<T>;
  /**
   * @inheritdoc
   */
  public get<T>(
    token: InjectionToken<T>,
    options: ModuleRefContextOptions,
  ): Promise<T>;
  public get<T>(
    token: InjectionToken<T>,
    _options?: ModuleRefOptions | ModuleRefContextOptions,
  ): Promise<T> {
    return this.ctx.resolveInternal<T>(token);
  }

  /**
   * @inheritdoc
   */
  public getByTag<T = unknown>(
    tag: Tag,
    options?: ModuleRefOptions,
  ): Promise<T[]>;
  /**
   * @inheritdoc
   */
  public getByTag<T = unknown>(
    tags: Tag[],
    options: ModuleRefContextOptions,
  ): Promise<T[]>;
  public async getByTag<T = unknown>(
    arg0: Tag | Tag[],
    _options?: ModuleRefOptions | ModuleRefContextOptions,
  ): Promise<T[]> {
    if (Array.isArray(arg0)) {
      return (
        await Promise.all(
          arg0.map((tag) => this.ctx.container.getByTag<T>(tag)),
        )
      ).flat();
    }

    return this.ctx.container.getByTag<T>(arg0);
  }

  /**
   * @inheritdoc
   */
  public init(): Promise<void> {
    return this.ctx.onApplicationBootstrap();
  }

  /**
   * @inheritdoc
   */
  public async close(): Promise<void> {
    await this.ctx.onBeforeApplicationShutdown();
    await this.ctx.onApplicationShutdown();
  }
}
