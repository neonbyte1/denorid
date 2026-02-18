import {
  hasOnApplicationBootstrap,
  hasOnApplicationShutdown,
  hasOnBeforeApplicationShutdown,
  hasOnModuleDestroy,
  hasOnModuleInit,
} from "./_internal.ts";
import { type CompiledModule, ModuleCompiler } from "./_module_compiler.ts";
import { runInModuleContext } from "./_module_context.ts";
import {
  runInRequestContext,
  runInRequestContextAsync,
} from "./_request_context.ts";
import type { InjectionToken, Type } from "./common.ts";
import { Container } from "./container.ts";
import { LifecycleError, TokenNotFoundError } from "./errors.ts";
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnBeforeApplicationShutdown,
} from "./hooks.ts";
import { ModuleRef } from "./module_ref.ts";
import type { DynamicModule } from "./modules.ts";
import type { Provider } from "./provider.ts";

/**
 * Interface to configure the {@linkcode InjectorContext}.
 */
export interface InjectorContextOptions {
  /**
   * Wether to use global providers in this context.
   *
   * @default true
   */
  useGlobals?: boolean;
}

/**
 * Lifecycle hooks available for the {@linkcode InjectorContext}.
 *
 * @note The {@linkcode InjectorContext} is modular and can be used in different project
 *       environments, therefore you must call the methods of {@linkcode InjectorContextLifecycle}
 *       manually.
 */
export interface InjectorContextLifecycle
  extends
    OnApplicationBootstrap,
    OnBeforeApplicationShutdown,
    OnApplicationShutdown {}

/**
 * Dependency injector context.
 *
 * The `InjectorContext` is resposible for orchestrating the compilation, injection and resolution.
 */
export class InjectorContext implements InjectorContextLifecycle {
  protected isBootstrapped: boolean = false;
  protected isShuttingDown: boolean = false;

  /**
   * @param {Container} container - The root container managing all providers and children
   * @param {CompiledModule} rootModule - The compiled root module context
   * @param {CompiledModule[]} modulesInOrder - The list of copmiled modules in resolution order
   * @param {Map<Type, ModuleRef>} moduleRefs - A map from module class types to their module references
   */
  private constructor(
    public readonly container: Container,
    protected readonly rootModule: CompiledModule,
    protected readonly modulesInOrder: CompiledModule[],
    protected readonly moduleRefs: Map<Type, ModuleRef>,
  ) {}

  /**
   * Creates a new {@linkcode InjectorContext} asynchronously.
   *
   * This compiled the module tree, creates hierarchial containers,
   * instantiates modules and calls the {@linkcode OnModuleInit} hook (depth-first).
   *
   * @param {Type|DynamicModule} rootModule - The root (dynamic) module to bootstrap the context
   * @param {InjectorContextOptions|undefined} options - Optional configuration for the injector context
   * @returns {Promise<InjectorContext>} The function returns a `Promise` that resolves into
   *          {@linkcode InjectorContext} when fulfilled.
   */
  static async create(
    rootModule: Type | DynamicModule,
    options?: InjectorContextOptions,
  ): Promise<InjectorContext> {
    const compiler = new ModuleCompiler();
    const compiled = await compiler.compile(rootModule);
    const modulesInOrder = compiler.getModulesInInitOrder(compiled);

    const globalContainer = new Container();
    if (options?.useGlobals !== false) {
      globalContainer.register(...compiler.getGlobalProviders());
    }

    const moduleContainers = new Map<Type, Container>();

    const buildContainer = (mod: CompiledModule): Container => {
      if (moduleContainers.has(mod.type)) {
        return moduleContainers.get(mod.type)!;
      }

      const childContainers: Container[] = [];

      for (const importedMod of mod.imports) {
        childContainers.push(buildContainer(importedMod));
      }

      const container = new Container({
        exports: mod.exports,
        globalContainer,
      });

      for (const child of childContainers) {
        container.addChild(child);
      }

      moduleContainers.set(mod.type, container);

      const providerMap = new Map<InjectionToken, Provider>();

      for (const provider of mod.providers) {
        const token = typeof provider === "function"
          ? provider
          : provider.provide;

        providerMap.set(token, provider);
      }

      for (const token of mod.ownTokens) {
        const provider = providerMap.get(token);

        if (provider) {
          container.register(provider);
        } else if (typeof token === "function") {
          container.register(token);
        }
      }

      return container;
    };

    const rootContainer = buildContainer(compiled);
    const moduleRefs = new Map<Type, ModuleRef>();

    for (const mod of modulesInOrder) {
      const container = moduleContainers.get(mod.type)!;
      const moduleRef = new ModuleRef(container, mod.ownTokens);

      moduleRefs.set(mod.type, moduleRef);
    }

    const initializedInstances = new Set<unknown>();

    const callOnModuleInit = async (instance: unknown) => {
      if (!initializedInstances.has(instance)) {
        initializedInstances.add(instance);

        if (hasOnModuleInit(instance)) {
          await instance.onModuleInit();
        }
      }
    };

    for (const mod of modulesInOrder) {
      const container = moduleContainers.get(mod.type)!;
      const moduleRef = moduleRefs.get(mod.type)!;

      await runInModuleContext(moduleRef, async () => {
        for (const token of mod.ownTokens) {
          if (container.isRequestScoped(token)) {
            continue;
          }

          try {
            const instance = await container.resolve(token);
            await callOnModuleInit(instance);
          } catch {
            /** @todo: double check - provider might be transient, skip silently? */
          }
        }

        const moduleInstance = await container.resolve(mod.type);

        await callOnModuleInit(moduleInstance);
      });
    }

    return new InjectorContext(
      rootContainer,
      compiled,
      modulesInOrder,
      moduleRefs,
    );
  }

  /**
   * Resolve a dependency from the application.
   *
   * @note Only tokens exported from the root module, global tokens or
   *       the root module itself can be resolved.
   *
   * @async
   * @template T - The resolved token type
   * @param {InjectionToken<T>} token - The injection token to resolve
   * @returns {Promise<T>} The function returns a `Promise` that resolves into the
   *          instantiated value as `T`.
   * @throws {CircularDependencyError}
   * @throws {TokenNotFoundError}
   * @throws {RequestContextError}
   */
  public resolve<T>(token: InjectionToken<T>): Promise<T> {
    if (token === this.rootModule.type) {
      return this.container.resolve(token);
    }

    if (this.rootModule.exports.has(token)) {
      return this.container.resolve(token);
    }

    if (this.rootModule.ownTokens.has(token)) {
      throw new TokenNotFoundError(token);
    }

    return this.container.resolve(token);
  }

  /**
   * Resolve a dependency from the application.
   *
   * @note The function _can_ still throw an `Error` that isn't `TokenNotfoundError`.
   *
   * @async
   * @template T - The resolved token type
   * @param {InjectionToken<T>} token - The injection token to resolve
   * @returns {Promise<T>} The function returns a `Promise` that resolves into
   *          the instantiated value as `T` or `undefined` if the token couldn't
   *          be resolved when fulfilled.
   */
  public async tryResolve<T>(token: InjectionToken<T>): Promise<T | undefined> {
    try {
      return await this.resolve(token);
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve a dependency without checking exports (internal use).
   *
   * @note Use this when you need to bypass export restrictions.
   *
   * @async
   * @template T - The resolved token type
   * @param {InjectionToken<T>} token - The injection token to resolve
   * @returns {Promise<T>} The function returns a `Promise` that resolves into
   *          the instantiated value when fulfilled.
   */
  public resolveInternal<T>(token: InjectionToken<T>): Promise<T> {
    return this.container.resolve(token);
  }

  /**
   * Get the root module instance.
   *
   * @async
   * @template T - The resolved module type
   * @returns {Promise<T>} The function returns a `Promise` that resolves into
   *          the root module instance when fulfilled.
   */
  public getRootModule<T = unknown>(): Promise<T> {
    return this.container.resolve(this.rootModule.type) as Promise<T>;
  }

  /**
   * Run a function within a request context.
   *
   * @async
   * @template T - The function return type
   * @param {string} requestId - The request associated unique identifier
   * @param {() => T} fn - Callback executed within a `AsyncLocalStorage`
   * @returns {T} The function executes `fn` and returns its result.
   */
  public runInRequestScope<T>(requestId: string, fn: () => T): T {
    return runInRequestContext(requestId, fn);
  }

  /**
   * Run an async function within a request context.
   *
   * @async
   * @template T - The function return type
   * @param {string} requestId - The request associated unique identifier
   * @param {() => T} fn - Callback executed within a `AsyncLocalStorage`
   * @returns {Promise<T>} The function returns a `Promise` that resolves
   *                       into what `fn` returns when fulfilled.
   */
  public runInRequestScopeAsync<T>(
    requestId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return runInRequestContextAsync(requestId, fn);
  }

  /**
   * Trigger the {@linkcode OnApplicationBootstrap} hook on all providers.
   *
   * @note Should be called by your application / framework after its own initialization is complete.
   *
   * @async
   *
   * @example Usage
   * ```ts
   * const ctx = await InjectorContext.create(AppModule);
   * await framework.initialize();
   * await ctx.onApplicationBootstrap();
   * ```
   */
  public async onApplicationBootstrap(): Promise<void> {
    if (this.isBootstrapped) {
      return;
    }

    const errors: Error[] = [];
    const instances = this.container.getInstances({ recursive: true });

    for (const instance of instances) {
      if (hasOnApplicationBootstrap(instance)) {
        try {
          await instance.onApplicationBootstrap();
        } catch (error) {
          errors.push(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }

    this.isBootstrapped = true;

    if (errors.length > 0) {
      throw new LifecycleError("onApplicationBootstrap", errors);
    }
  }

  /**
   * Trigger the {@linkcode OnBeforeApplicationShutdown} hook on all providers.
   *
   * @note Should be called by your program / framework before cleanup begins.
   *
   * @async
   * @param {Deno.Signal|string} signal - Optional shutdown signal (e.g., "SIGTERM")
   *
   * @example Usage
   * ```ts
   * const ctx = await InjectorContext.create(AppModule);
   * await framework.initialize();
   * await ctx.onBeforeApplicationShutdown("SIGTERM");
   * ```
   */
  public async onBeforeApplicationShutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    const errors: Error[] = [];
    const instances = this.container.getInstances({ recursive: true });

    for (const instance of [...instances].reverse()) {
      if (hasOnBeforeApplicationShutdown(instance)) {
        try {
          await instance.onBeforeApplicationShutdown(signal);
        } catch (error) {
          errors.push(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new LifecycleError("onBeforeApplicationShutdown", errors);
    }
  }

  /**
   * Trigger {@linkcode OnModuleDestory} and {@linkcode OnApplicationShutdown} on all providers.
   *
   * @note Should be called by your program / framework during final cleanup.
   *
   * @async
   * @param signal - Optional shutdown signal (e.g., "SIGTERM")
   */
  public async onApplicationShutdown(signal?: string): Promise<void> {
    const errors: Error[] = [];
    const instances = this.container.getInstances({ recursive: true });

    for (const instance of [...instances].reverse()) {
      if (hasOnModuleDestroy(instance)) {
        try {
          await instance.onModuleDestroy();
        } catch (error) {
          errors.push(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }

    for (const instance of [...instances].reverse()) {
      if (hasOnApplicationShutdown(instance)) {
        try {
          await instance.onApplicationShutdown(signal);
        } catch (error) {
          errors.push(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }

    this.container.clear();

    if (errors.length > 0) {
      throw new LifecycleError("shutdown", errors);
    }
  }

  /**
   * Performs the full shutdown sequence.
   *
   * @async
   * @param {Deno.Signal|string} signal - Optional the signal received for termination
   */
  public async close(signal?: string): Promise<void> {
    await this.onBeforeApplicationShutdown(signal);
    await this.onApplicationShutdown(signal);
  }
}
