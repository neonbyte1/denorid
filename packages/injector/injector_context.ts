import { Logger } from "@denorid/logger";
import { sortByCreation } from "./_creation_order.ts";
import {
  hasOnApplicationBootstrap,
  hasOnApplicationShutdown,
  hasOnBeforeApplicationShutdown,
  hasOnModuleDestroy,
  hasOnModuleInit,
  serializeToken,
} from "./_internal.ts";
import { type CompiledModule, ModuleCompiler } from "./_module_compiler.ts";
import { bindModuleRef, runInModuleContext } from "./_module_context.ts";
import { resolveFromGraph } from "./_module_graph.ts";
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
import { getProviderToken, type Provider } from "./provider.ts";

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

  /**
   * Called after the context is constructed but before any {@linkcode OnModuleInit}
   * hooks run. Use this to register global providers that must be injectable into
   * module constructors.
   *
   * @param {InjectorContext} ctx - The freshly constructed (not yet initialised) context.
   */
  beforeInit?: (ctx: InjectorContext) => void | Promise<void>;

  /**
   * Providers replacing the module providers with the same token, in every
   * module (including global ones) that declares that token. The last
   * override per token wins. Tokens no module declares are ignored, and the
   * visibility (exports) of an overridden token does not change.
   */
  overrides?: Provider[];
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
 * Disposes an object through `Symbol.asyncDispose` or, when missing,
 * `Symbol.dispose`.
 *
 * @param {object} value - The object to dispose
 * @returns {Promise<void>} Resolves when the object is disposed, immediately
 *          for objects that are not disposable.
 */
async function dispose(value: object): Promise<void> {
  const { [Symbol.asyncDispose]: asyncDispose, [Symbol.dispose]: syncDispose } =
    value as Partial<AsyncDisposable & Disposable>;

  if (typeof asyncDispose === "function") {
    await asyncDispose.call(value);
  } else if (typeof syncDispose === "function") {
    syncDispose.call(value);
  }
}

/**
 * Converts a thrown value into an `Error`.
 *
 * @param {unknown} error - The thrown value
 * @returns {Error} `error` itself, or an `Error` carrying its string form.
 */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Dependency injector context.
 *
 * The `InjectorContext` is resposible for orchestrating the compilation, injection and resolution.
 *
 * Disposing the context (`await using ctx = await InjectorContext.create(...)`)
 * runs {@linkcode close}.
 */
export class InjectorContext
  implements InjectorContextLifecycle, AsyncDisposable {
  protected isBootstrapped: boolean = false;
  protected isShuttingDown: boolean = false;
  private closing?: Promise<void>;
  private allContainers?: Container[];

  /**
   * @param {Container} container - The root container managing all providers and children
   * @param {Container} globalContainer - The shared global container accessible by all module containers
   * @param {CompiledModule} rootModule - The compiled root module context
   * @param {CompiledModule[]} modulesInOrder - The list of copmiled modules in resolution order
   * @param {Map<Type, ModuleRef>} moduleRefs - A map from module class types to their module references
   * @param {ReadonlyArray<Container>} moduleContainers - Every module container,
   *        including those not reachable from `container` (the imports of
   *        dropped module variants). Lifecycle hooks, `clearContext` and
   *        shutdown cover them together with `container`, its descendants and
   *        `globalContainer`.
   */
  public constructor(
    public readonly container: Container,
    private readonly globalContainer: Container,
    protected readonly rootModule: CompiledModule,
    protected readonly modulesInOrder: CompiledModule[],
    protected readonly moduleRefs: Map<Type, ModuleRef>,
    protected readonly moduleContainers: ReadonlyArray<Container> = [],
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
    const logger = new Logger("Injector", { timestamp: true });
    const compiler = new ModuleCompiler();
    const compiled = await compiler.compile(rootModule);
    const modulesInOrder = compiler.getModulesInInitOrder(compiled);

    const globalContainer = new Container(logger);

    const moduleContainers = new Map<Type, Container>();
    // The variant that filled the container of its module class.
    const containerVariants = new Map<Type, CompiledModule>();
    const builtModules = new Set<CompiledModule>();

    const overrides = new Map<InjectionToken, Provider>(
      (options?.overrides ?? []).map((
        provider,
      ) => [getProviderToken(provider), provider]),
    );

    const ownProviders = (mod: CompiledModule): Provider[] => {
      const providerMap = new Map<InjectionToken, Provider>();

      for (const provider of mod.providers) {
        providerMap.set(getProviderToken(provider), provider);
      }

      const providers: Provider[] = [];

      for (const token of mod.ownTokens) {
        const provider = overrides.get(token) ?? providerMap.get(token);

        if (provider) {
          providers.push(provider);
        } else if (typeof token === "function") {
          providers.push(token);
        }
      }

      return providers;
    };

    const buildContainer = (mod: CompiledModule): Container => {
      if (builtModules.has(mod)) {
        return moduleContainers.get(mod.type)!;
      }

      builtModules.add(mod);

      const childContainers: Container[] = [];

      // Build imports first, even for a module class that already has a
      // container: a later variant (e.g. `X.forRoot()` after plain `X`) is
      // dropped, but its imports still take part in the init lifecycle and
      // need a container.
      for (const importedMod of mod.imports) {
        childContainers.push(buildContainer(importedMod));
      }

      const existing = moduleContainers.get(mod.type);

      if (existing) {
        return existing;
      }

      const container = new Container(logger, {
        exports: mod.exports,
        globalContainer,
      });

      for (const child of childContainers) {
        container.addChild(child);
      }

      moduleContainers.set(mod.type, container);
      containerVariants.set(mod.type, mod);

      for (const provider of ownProviders(mod)) {
        container.register(provider);
      }

      return container;
    };

    const rootContainer = buildContainer(compiled);
    const moduleRefs = new Map<Type, ModuleRef>();

    for (const [type, mod] of containerVariants) {
      const container = moduleContainers.get(type)!;
      const moduleRef = new ModuleRef(container, rootContainer, mod.ownTokens);

      moduleRefs.set(type, moduleRef);
      bindModuleRef(container, moduleRef);
    }

    // Tokens whose global registration is a scoped copy, by module variant.
    const scopedGlobals = new Map<InjectionToken, CompiledModule>();

    if (options?.useGlobals !== false) {
      // Later modules override earlier ones for the same token.
      for (const mod of modulesInOrder) {
        if (!mod.isGlobal) {
          continue;
        }

        const providers = ownProviders(mod).filter((provider) =>
          getProviderToken(provider) !== mod.type
        );

        if (containerVariants.get(mod.type) === mod) {
          // The module container holds these providers: expose its
          // instances instead of creating a second one.
          globalContainer.registerForwarded(
            moduleContainers.get(mod.type)!,
            ...providers,
          );

          for (const provider of providers) {
            scopedGlobals.delete(getProviderToken(provider));
          }

          continue;
        }

        // A dropped variant has no container of its own: its providers live
        // in the global container, but resolve their dependencies like
        // inside the module (through its imports first), without exposing
        // those imports to anyone else.
        const scope = new Container(logger, { globalContainer });

        for (const importedMod of mod.imports) {
          scope.addChild(moduleContainers.get(importedMod.type)!);
        }

        bindModuleRef(
          scope,
          new ModuleRef(scope, rootContainer, mod.ownTokens),
        );
        globalContainer.registerScoped(scope, ...providers);

        for (const provider of providers) {
          scopedGlobals.set(getProviderToken(provider), mod);
        }
      }
    }

    const context = new InjectorContext(
      rootContainer,
      globalContainer,
      compiled,
      modulesInOrder,
      moduleRefs,
      [...moduleContainers.values()],
    );

    if (options?.beforeInit) {
      await options.beforeInit(context);
    }

    const initializedInstances = new Set<unknown>();

    const callOnModuleInit = async (instance: unknown): Promise<void> => {
      if (!initializedInstances.has(instance)) {
        initializedInstances.add(instance);

        if (hasOnModuleInit(instance)) {
          await instance.onModuleInit();
        }
      }
    };

    // Only singletons are initialized: transient and request-scoped
    // instances belong to their consumer.
    const initialize = async (
      container: Container,
      token: InjectionToken,
    ): Promise<void> => {
      const mode = container.getProviderMode(token);

      if (mode !== undefined && mode !== "singleton") {
        return;
      }

      try {
        await callOnModuleInit(await container.resolve(token));
      } catch (e) {
        const err = toError(e);

        logger.error(
          `Failed to initialize ${serializeToken(token)}: ${err.message}`,
          err.stack,
        );
      }
    };

    for (const mod of modulesInOrder) {
      const container = moduleContainers.get(mod.type)!;
      const moduleRef = moduleRefs.get(mod.type)!;

      await runInModuleContext(moduleRef, async () => {
        for (const token of mod.ownTokens) {
          await initialize(container, token);

          if (scopedGlobals.get(token) === mod) {
            await initialize(globalContainer, token);
          }
        }

        const moduleInstance = await container.resolve(mod.type);

        await callOnModuleInit(moduleInstance);

        logger.log(`${mod.type.name} dependencies initialized`);
      });
    }

    return context;
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
  public async resolve<T>(token: InjectionToken<T>): Promise<T> {
    if (
      token !== this.rootModule.type &&
      !this.rootModule.exports.has(token) &&
      this.rootModule.ownTokens.has(token)
    ) {
      throw new TokenNotFoundError(token);
    }

    return await this.container.resolve(token);
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
    } catch (e) {
      if (e instanceof TokenNotFoundError) {
        return undefined;
      }

      throw e;
    }
  }

  /**
   * Resolve a dependency without checking exports (internal use): through
   * the root module when the token is visible there (own, exported by an
   * import or global), otherwise from the module that declares it.
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
    return resolveFromGraph(this.container, token);
  }

  /**
   * Resolve a dependency within a named context.
   *
   * Applies the same export checks as {@linkcode resolve}. Transient providers
   * are cached per `contextId` - the same `contextId` returns the same instance,
   * while a different `contextId` produces a fresh one.
   *
   * Use {@linkcode clearContext} to release cached instances when a context ends.
   *
   * @async
   * @template T - The resolved token type
   * @param {InjectionToken<T>} token - The injection token to resolve
   * @param {string} contextId - The context identifier for transient caching
   * @returns {Promise<T>} The function returns a `Promise` that resolves into
   *          the instantiated value as `T` when fulfilled.
   * @throws {CircularDependencyError}
   * @throws {TokenNotFoundError}
   * @throws {RequestContextError}
   */
  public async resolveWithinContext<T>(
    token: InjectionToken<T>,
    contextId: string,
  ): Promise<T> {
    if (
      token !== this.rootModule.type &&
      !this.rootModule.exports.has(token) &&
      this.rootModule.ownTokens.has(token)
    ) {
      throw new TokenNotFoundError(token);
    }

    return await this.container.resolveWithContext(token, contextId);
  }

  /**
   * Clear the instance cache for a specific context in every container of
   * the context.
   *
   * @param {string} contextId - The context identifier to clear
   */
  public clearContext(contextId: string): void {
    for (const container of this.containers()) {
      container.clearContext(contextId);
    }
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
   * Get the {@linkcode ModuleRef} for the root (host) module.
   *
   * @returns {ModuleRef} The `ModuleRef` associated with the root module.
   */
  public getHostModuleRef(): ModuleRef {
    return this.moduleRefs.get(this.rootModule.type)!;
  }

  /**
   * Register providers into the shared global container, making them
   * resolvable from any module in the context.
   *
   * @param {...Provider[]} providers - One or more providers to register globally.
   * @returns {this}
   */
  public registerGlobal(...providers: Provider[]): this {
    this.globalContainer.register(...providers);

    return this;
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
   * Trigger the {@linkcode OnApplicationBootstrap} hook on all singletons,
   * oldest first (dependencies before their consumers).
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

    for (const instance of this.lifecycleInstances()) {
      if (hasOnApplicationBootstrap(instance)) {
        try {
          await instance.onApplicationBootstrap();
        } catch (error) {
          errors.push(toError(error));
        }
      }
    }

    this.isBootstrapped = true;

    if (errors.length > 0) {
      throw new LifecycleError("onApplicationBootstrap", errors);
    }
  }

  /**
   * Trigger the {@linkcode OnBeforeApplicationShutdown} hook on all
   * singletons, newest first (consumers before their dependencies).
   *
   * @note Should be called by your program / framework before cleanup begins.
   *
   * @async
   * @param {string} signal - Optional shutdown signal (e.g., "SIGTERM")
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

    for (const instance of this.lifecycleInstances().reverse()) {
      if (hasOnBeforeApplicationShutdown(instance)) {
        try {
          await instance.onBeforeApplicationShutdown(signal);
        } catch (error) {
          errors.push(toError(error));
        }
      }
    }

    if (errors.length > 0) {
      throw new LifecycleError("onBeforeApplicationShutdown", errors);
    }
  }

  /**
   * Trigger {@linkcode OnModuleDestory} and then {@linkcode OnApplicationShutdown}
   * on all singletons, then dispose the singletons the context created itself
   * (class and factory providers, not `useValue`/`useExisting`) through
   * `Symbol.asyncDispose` or `Symbol.dispose`. Every phase runs newest first
   * (consumers before their dependencies). Finally clears every container.
   *
   * @note Should be called by your program / framework during final cleanup.
   *
   * @async
   * @param signal - Optional shutdown signal (e.g., "SIGTERM")
   */
  public async onApplicationShutdown(signal?: string): Promise<void> {
    const errors: Error[] = [];
    const instances = this.lifecycleInstances().reverse();
    const owned = new Set<unknown>();

    for (const container of this.containers()) {
      for (const instance of container.getOwnedInstances()) {
        owned.add(instance);
      }
    }

    for (const instance of instances) {
      if (hasOnModuleDestroy(instance)) {
        try {
          await instance.onModuleDestroy();
        } catch (error) {
          errors.push(toError(error));
        }
      }
    }

    for (const instance of instances) {
      if (hasOnApplicationShutdown(instance)) {
        try {
          await instance.onApplicationShutdown(signal);
        } catch (error) {
          errors.push(toError(error));
        }
      }
    }

    for (const instance of instances) {
      if (owned.has(instance)) {
        try {
          await dispose(instance);
        } catch (error) {
          errors.push(toError(error));
        }
      }
    }

    for (const container of this.containers()) {
      container.clear();
    }

    if (errors.length > 0) {
      throw new LifecycleError("shutdown", errors);
    }
  }

  /**
   * Performs the full shutdown sequence: {@linkcode onBeforeApplicationShutdown},
   * then {@linkcode onApplicationShutdown}, which also runs when the first
   * phase fails. Later calls return the result of the first one.
   *
   * @async
   * @param {string} signal - Optional the signal received for termination
   * @throws {LifecycleError} With the errors of both phases when hooks or
   *         disposers fail.
   */
  public close(signal?: string): Promise<void> {
    this.closing ??= this.shutdown(signal);

    return this.closing;
  }

  /**
   * Closes the context, see {@linkcode close}.
   *
   * @returns {Promise<void>} Resolves when the context is closed.
   */
  public [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  /**
   * Runs both shutdown phases, the second one even when the first one fails.
   *
   * @param {string|undefined} signal - The signal received for termination
   * @returns {Promise<void>} Resolves when both phases completed.
   * @throws {LifecycleError} With the errors of both phases.
   */
  private async shutdown(signal?: string): Promise<void> {
    const errors: Error[] = [];

    for (
      const phase of [
        () => this.onBeforeApplicationShutdown(signal),
        () => this.onApplicationShutdown(signal),
      ]
    ) {
      try {
        await phase();
      } catch (error) {
        errors.push(
          ...(error instanceof LifecycleError
            ? error.errors
            : [error as Error]),
        );
      }
    }

    if (errors.length > 0) {
      throw new LifecycleError("shutdown", errors);
    }
  }

  /**
   * Every container of the context: the root container and its descendants,
   * the other module containers and the global container.
   *
   * @returns {Container[]} The containers, each once.
   */
  private containers(): Container[] {
    if (!this.allContainers) {
      const containers = new Set<Container>([
        this.container,
        ...this.moduleContainers,
        this.globalContainer,
      ]);

      for (const container of containers) {
        for (const child of container.getChildren()) {
          containers.add(child);
        }
      }

      this.allContainers = [...containers];
    }

    return this.allContainers;
  }

  /**
   * The singletons of every container, oldest first. The context itself
   * (registered as a global value by frameworks) is left out.
   *
   * @returns {object[]} The instances in creation order.
   */
  private lifecycleInstances(): object[] {
    const instances = new Set<unknown>();

    for (const container of this.containers()) {
      for (const instance of container.getInstances()) {
        instances.add(instance);
      }
    }

    instances.delete(this);

    return sortByCreation(instances);
  }
}
