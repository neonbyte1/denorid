import type { LoggerService } from "@denorid/logger";
import {
  getInjectionDependencies,
  getTags,
  serializeToken,
} from "./_internal.ts";
import { getCurrentModuleRef } from "./_module_context.ts";
import {
  type NormalizedProvider,
  normalizeProvider,
} from "./_normalized_provider.ts";
import { getRequestContext } from "./_request_context.ts";
import type {
  InjectableMode,
  InjectionToken,
  RecursiveResolutionOption,
  Tag,
  Type,
} from "./common.ts";
import {
  CircularDependencyError,
  RequestContextError,
  TokenNotFoundError,
} from "./errors.ts";
import { isClassProvider, type Provider } from "./provider.ts";

/**
 * Interface to optionally configure the dependency container instance.
 */
export interface ContainerOptions {
  /**
   * Parent container for hierarchical resolution. An `undefined` value means
   * this container is the **root** container.
   */
  parent?: Container;

  /**
   * Tokens that are exported / visible to parent containers.
   */
  exports?: Set<InjectionToken>;

  /**
   * Global container (if specified) that's always accessible.
   */
  globalContainer?: Container;
}

/**
 * Dependency injection container.
 *
 * The `Container` is responsible for registering and resolving providers.
 *
 * @example Usage
 * ```ts
 * const container = new Container();
 *
 * container.register({
 *   provide: "example",
 *   useValue: Date.now(),
 * });
 *
 * await container.resolve<Date>("example");
 * ```
 */
export class Container {
  private providers = new Map<InjectionToken, NormalizedProvider>();
  private singletons = new Map<InjectionToken, unknown>();
  private resolving = new Set<InjectionToken>();

  /**
   * Parent container.
   *
   * @default undefined
   */
  private parent?: Container;

  /**
   * Child containers (imported modules).
   *
   * @type {Container[]}
   * @default []
   */
  private readonly children: Container[] = [];

  /**
   * Tokens that are exported / visible to parent containers.
   */
  private exports = new Set<InjectionToken>();

  /**
   * Global container (if specified) that's always accessible.
   */
  private globalContainer?: Container;

  /**
   * All instances created by this container (for lifecycle management).
   */
  private instances: unknown[] = [];

  /**
   * Mapping to collect all tokens for specified tags.
   */
  private tagToTokens = new Map<Tag, Set<InjectionToken>>();

  /**
   * Per-context instance caches for context-scoped transient resolution.
   */
  private contexts = new Map<string, Map<InjectionToken, unknown>>();

  /**
   * Creates a new container instance.
   *
   * @param options - Optional container configuration (see {@linkcode ContainerOptions})
   */
  public constructor(
    private readonly logger: LoggerService,
    options?: ContainerOptions,
  ) {
    this.parent = options?.parent;
    this.exports = options?.exports ?? new Set();
    this.globalContainer = options?.globalContainer;

    this.parent?.children?.push(this);
  }

  /**
   * Register a provider in the container.
   *
   * @param {...Provider[]} providers - Providers passed as rest arguments
   * @returns {Container} Reference to `this` object.
   *
   * @example Usage
   * ```ts
   * const container = new Container();
   *
   * container
   *   .register(UserService)
   *   .register({
   *     provide: "config",
   *     useValue: { env: "dev" },
   *   });
   * ```
   */
  public register(...providers: Provider[]): this {
    for (const provider of providers) {
      const normalized = normalizeProvider(provider);

      this.providers.set(normalized.token, normalized);

      const targetClass = this.getProviderClass(provider);

      if (targetClass) {
        this.mapTagsToTokens(targetClass, normalized);
      }
    }

    return this;
  }

  /**
   * Set exported tokens (visible to parent containers).
   *
   * @param {Set<InjectionToken>} tokens -
   * @returns {Container} Reference to `this` object.
   */
  public setExports(tokens: Set<InjectionToken>): this {
    this.exports = tokens;

    return this;
  }

  /**
   * Register a child container (imported module).
   *
   * @param {Container} child - The imported module container
   * @returns {Container} Reference to `this` object.
   */
  public addChild(child: Container): this {
    this.children.push(child);

    child.parent = this;

    return this;
  }

  /**
   * Check if the given `token` is exported (visible to parent containers)
   * in this container only.
   *
   * @param {InjectionToken} token - The provder token.
   * @returns The function returns `true` if the container exports the `token`, `false` otherwise.
   */
  public isExported(token: InjectionToken): boolean {
    return this.exports.has(token);
  }

  /**
   * Check if a provider exists for the given `token` in this container only.
   *
   * @param {InjectionToken} token - The provider token
   * @returns The function returns `true` if the container has a provider with the
   *          given `token`, `false` otherwise.
   */
  public has(token: InjectionToken): boolean {
    return this.providers.has(token);
  }

  /**
   * Check if a token can be resolved (own, exported from children, or global).
   *
   * @param {InjectionToken} token - The provider token
   * @returns {boolean} The function returns `true` if the given `token` can be
   *                    resolved from the current container, `false` otherwise.
   */
  public canResolve(token: InjectionToken): boolean {
    if (this.providers.has(token)) {
      return true;
    }

    for (const child of this.children) {
      if (child.isExported(token) && child.canResolve(token)) {
        return true;
      }
    }

    if (this.globalContainer && this.globalContainer !== this) {
      if (this.globalContainer.has(token)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the mode ({@linkcode InjectableMode}) of a provider.
   *
   * @param {InjectionToken} token - The provider token
   * @returns {InjectableMode|undefined} The function returns the mode as `string`
   *          if the provider was found, otherwise `undefined`.
   */
  public getProviderMode(token: InjectionToken): InjectableMode | undefined {
    const provider = this.providers.get(token);

    if (provider) {
      return provider.mode;
    }

    for (const child of this.children) {
      if (child.isExported(token)) {
        const mode = child.getProviderMode(token);

        if (mode) {
          return mode;
        }
      }
    }

    if (this.globalContainer && this.globalContainer !== this) {
      return this.globalContainer.getProviderMode(token);
    }

    return undefined;
  }

  /**
   * Check if a token is request-scoped.
   *
   * @param {InjectionToken} token - The provider token
   * @returns {boolean} The function returns `true` if the provider uses the `"request"`
   *          mode, otherwise `false`.
   */
  public isRequestScoped(token: InjectionToken): boolean {
    return this.getProviderMode(token) === "request";
  }

  /**
   * Resolve a dependency by its token, using the following resolution order:
   * 1. Own providers
   * 2. Exported providers from child containers (imported modules)
   * 3. Global providers
   *
   * @async
   * @template T - The resolved return type
   * @param {InjectionToken} token - The provider token
   * @returns
   * @throws {CircularDependencyError}
   * @throws {TokenNotFoundError}
   * @throws {RequestContextError}
   */
  public async resolve<T>(token: InjectionToken<T>): Promise<T> {
    if (this.resolving.has(token)) {
      throw new CircularDependencyError([...this.resolving, token]);
    }

    const provider = this.providers.get(token);

    if (provider) {
      return this.resolveWithMode(token, provider) as Promise<T>;
    }

    for (const child of this.children) {
      if (child.isExported(token)) {
        try {
          return await child.resolve(token);
        } catch (e) {
          if (!(e instanceof TokenNotFoundError)) {
            const err = e as Error;

            this.logger.error(
              `Failed to resolve ${serializeToken(token)}: ${err.message}`,
              err.stack,
            );

            throw err;
          }
        }
      }
    }

    if (this.globalContainer && this.globalContainer !== this) {
      if (this.globalContainer.has(token)) {
        return this.globalContainer.resolve(token);
      }
    }

    throw new TokenNotFoundError(token);
  }

  /**
   * Try to resolve a dependency by its token, using the following resolution order:
   * 1. Own providers
   * 2. Exported providers from child containers (imported modules)
   * 3. Global providers
   *
   * @note The function _can_ still throw an `Error` that isn't `TokenNotfoundError`.
   *
   * @async
   * @template T - The resolved return type
   * @param {InjectionToken} token - The provider token
   * @returns {T|undefined} The function returns a `Promise` that resolves into `T` when
   *          fulfilled, otherwise `undefined`.
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
   * Resolve all providers with a specific tag.
   *
   * @async
   * @param {Tag} tag - The tag to search for
   * @returns {Promise<T[]>} The function returns a `Promise` that resolves into
   *          an array of instances of type `T` when fulfilled.
   *
   * @example
   * ```ts
   * const validators = await container.getByTag(VALIDATOR);
   *
   * for (const validator of validators) {
   *   validator.validate(input);
   * }
   * ```
   */
  public async getByTag<T = unknown>(
    tag: Tag,
    contextId?: string,
  ): Promise<T[]> {
    const instances: T[] = [];
    const ownTokens = this.tagToTokens.get(tag);

    if (ownTokens) {
      for (const token of ownTokens) {
        try {
          const instance = contextId
            ? await this.resolveWithContext(token, contextId)
            : await this.resolve(token);

          instances.push(instance as T);
        } catch (e) {
          if (!(e instanceof TokenNotFoundError)) {
            const err = e as Error;

            this.logger.error(
              `Failed to resolve "${serializeToken(token)}" with tag "${
                String(tag)
              }": ${err.message}`,
              err.stack,
            );

            throw err;
          }
        }
      }
    }

    for (const child of this.children) {
      instances.push(...(await child.getExportedByTag<T>(tag, contextId)));
    }

    if (this.globalContainer && this.globalContainer !== this) {
      const globalTokens = this.globalContainer.tagToTokens.get(tag);

      if (globalTokens) {
        for (const token of globalTokens) {
          try {
            const instance = await this.globalContainer.resolve(token);

            instances.push(instance as T);
          } catch (e) {
            if (!(e instanceof TokenNotFoundError)) {
              const err = e as Error;

              this.logger.error(
                `Failed to resolve "${serializeToken(token)}" with tag "${
                  String(tag)
                }" from global container: ${err.message}`,
                err.stack,
              );

              throw err;
            }
          }
        }
      }
    }

    return instances;
  }

  /**
   * Get all tokens registered with a specific tag (without resolving).
   *
   * @param {Tag} tag - The searchable tag
   * @param {boolean|undefined} bypassExportCheck - Optional bypass the isExported() logic
   * @returns {InjectionToken[]} The function returns an array of `InjectionToken`
   *          that have the requested tag.
   */
  public getTokensByTag(
    tag: Tag,
    bypassExportCheck?: boolean,
  ): InjectionToken[] {
    bypassExportCheck ??= false;

    const result: InjectionToken[] = [];
    const ownTokens = this.tagToTokens.get(tag);

    if (ownTokens) {
      result.push(...ownTokens);
    }

    for (const child of this.children) {
      const childTokens = child.tagToTokens.get(tag);

      if (childTokens) {
        for (const token of childTokens) {
          if (bypassExportCheck || child.isExported(token)) {
            result.push(token);
          }
        }
      }
    }

    if (this.globalContainer && this.globalContainer !== this) {
      const globalTokens = this.globalContainer.tagToTokens.get(tag);

      if (globalTokens) {
        result.push(...globalTokens);
      }
    }

    return result;
  }

  /**
   * Instantiate a class and inject its dependencies.
   *
   * @note If running within a module context (via {@linkcode runInModuleContext}),
   *       the {@linkcode ModuleRef} will be passed as the first constructor argument.
   *
   * @template T - The actual class type
   * @param {Type<T>} target - The constructable class `T`
   *
   * @returns {Promise<T>} The function returns a `Promise` that resolves into `T`
   *          when fulfilled.
   *          The resolved value is the instantiated class with its dependencies.
   */
  public async instantiateClass<T>(target: Type<T>): Promise<T> {
    const moduleRef = getCurrentModuleRef();
    const instance = moduleRef ? new target(moduleRef) : new target();

    await this.injectDependencies(instance, target);

    return instance;
  }

  /**
   * Inject dependencies into an existing instance.
   *
   * @async
   * @template T - The actual instance type
   * @param {T} instance - The actual instance
   * @param {Type<T>} target The constructor (class) of the target `T`
   * @returns {Promise<void>} The functions returns a `Promise` that resolves into
   *          nothing when fulfilled, but injects the dependencies into the `instance`
   *          during this process.
   */
  public async injectDependencies<T>(
    instance: T,
    target: Type<T>,
  ): Promise<void> {
    const dependencies = getInjectionDependencies(target);

    for (const dep of dependencies) {
      try {
        const resolved = await this.resolve(dep.token);
        const value: unknown = dep.expression
          ? await dep.expression(resolved)
          : resolved;

        (instance as Record<Tag, unknown>)[dep.field] = value;
      } catch (e) {
        const err = e as Error;

        if (dep.options?.optional && err instanceof TokenNotFoundError) {
          continue;
        }

        this.logger.error(
          `Failed to inject ${
            serializeToken(dep.token)
          } into ${target.name}: ${err.message}`,
          err.stack,
        );

        throw e;
      }
    }
  }

  /**
   * Get all instances created by this container if no `options` are used or
   * {@linkcode RecursiveResolutionOption.recursive} is set to `false`. Otherwise
   * get all instances from this container and all children (imported modules).
   *
   * @param {RecursiveResolutionOption|undefined} options - Optional resolution option.
   * @returns {unknown[]} The function returns an array of resolved instances.
   */
  public getInstances(options?: RecursiveResolutionOption): unknown[] {
    const instances = [...this.instances];

    if (options?.recursive) {
      for (const child of this.children) {
        instances.push(...child.getInstances(options));
      }

      return [...new Set<unknown>(instances)];
    }

    return instances;
  }

  /**
   * Get all direct child containers of this container.
   *
   * @note The returned array is a shallow copy and cannot be used
   *       to mutate the internal children registry.
   *
   * @returns {ReadonlyArray<Container>} A _readonly_ array containing all child containers.
   */
  public getChildren(): ReadonlyArray<Container> {
    return [...this.children];
  }

  /**
   * Creates a new child container linked to this container.
   *
   * @param {Omit<ContainerOptions, "parent">} options - Optional configuration for the child container.
   * @returns {Container} The function returns a newly created child container instance.
   */
  public createChild(options?: Omit<ContainerOptions, "parent">): Container {
    return new Container(this.logger, {
      ...options,
      parent: this,
      globalContainer: this.globalContainer,
    });
  }

  /**
   * Clears all registered providers and cached instances from this container.
   */
  public clear(): void {
    this.providers.clear();
    this.singletons.clear();
    this.instances = [];
    this.tagToTokens.clear();
    this.contexts.clear();
  }

  /**
   * Clears the instance cache for a specific context.
   *
   * @param {string} contextId - The context identifier to clear
   */
  public clearContext(contextId: string): void {
    this.contexts.delete(contextId);
  }

  /**
   * Extract the concrete class constructor from a provider.
   *
   * Resolution rules:
   * - If `provider` is itself a constructo function, it's returned directly
   * - If `provider` is a class-based provider (`useClass`), the references class is returned
   * - If `provider.provide` is a constructor function, it's returned.
   * - Otherwise, `undefined` is returned (e.g. `provider.provide` is a `string` or `symbol`).
   *
   * @param provider - The provider to inspect
   * @returns {Type|undefined} The resolved class constructor os `undefined` if the
   *          `provider` doesn't expose a class.
   *
   * @internal
   */
  private getProviderClass(provider: Provider): Type | undefined {
    if (typeof provider === "function") {
      return provider;
    }
    if (isClassProvider(provider)) {
      return provider.useClass;
    }
    if (typeof provider.provide === "function") {
      return provider.provide;
    }
    return undefined;
  }

  /**
   * Maps all tags to provider tokens.
   *
   * @param {Type} target - The constructable target class
   * @param {NormalizedProvider} normalized - The normalized provider data
   *
   * @internal
   */
  private mapTagsToTokens(
    target: Type,
    normalized: NormalizedProvider,
  ): void {
    for (const tag of getTags(target)) {
      let mapping = this.tagToTokens.get(tag);

      if (!mapping) {
        mapping = new Set();

        this.tagToTokens.set(tag, mapping);
      }

      mapping.add(normalized.token);
    }
  }

  /**
   * Resolves a provider according to its configured mode.
   *
   * @async
   * @param {InjectionToken} token - The injection token associated with the provider
   * @param {NormalizedProvider} provider - The normalized provider definition
   * @returns {Promise<unknown>} The function returns a `Promise` that resolves into
   *          the instantiated value when fulfilled.
   *
   * @internal
   */
  private resolveWithMode(
    token: InjectionToken,
    provider: NormalizedProvider,
  ): Promise<unknown> {
    switch (provider.mode) {
      case "singleton":
        return this.resolveSingleton(token, provider);

      case "transient":
        return this.resolveTransient(provider);

      case "request":
        return this.resolveRequest(token, provider);

      default:
        /**
         * @todo double check : do we really need this? I don't think there's a reason for a fourth type,
         *       but right now we're treading it like a transient provider.
         */
        return this.resolveTransient(provider);
    }
  }

  /**
   * Resolve a singleton-scoped provider. The lifetime of this object
   * is tied to the lifetime of the container.
   *
   * @async
   * @param {InjectionToken} token
   * @param {NormalizedProvider} provider
   * @returns {unknown} The function returns a `Promise` that resolves into the
   *          instantiated value when fulfilled.
   *
   * @internal
   */
  private async resolveSingleton(
    token: InjectionToken,
    provider: NormalizedProvider,
  ): Promise<unknown> {
    if (this.singletons.has(token)) {
      return this.singletons.get(token);
    }

    this.resolving.add(token);

    try {
      const instance = await provider.resolve(this);

      this.singletons.set(token, instance);
      this.instances.push(instance);

      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }

  /**
   * Resolve a transient-scoped provider. The lifetime of this object
   * is tied to the usage. Transient means a new instance every time.
   *
   * The GC will remove it after the function call unless the resolved
   * value is an object and referenced somewhere else.
   *
   * @async
   * @param {NormalizedProvider} provider - The normalized provider definition
   * @returns {Promise<unknown>} The function returns a `Promise` that resolves into
   *          the instantiated value when fulfilled.
   *
   * @internal
   */
  private async resolveTransient(
    provider: NormalizedProvider,
  ): Promise<unknown> {
    this.resolving.add(provider.token);

    try {
      const instance = await provider.resolve(this);

      this.instances.push(instance);

      return instance;
    } finally {
      this.resolving.delete(provider.token);
    }
  }

  /**
   * Resolve a transient provider within a named context.
   *
   * Within the same `contextId` the same instance is returned. A different
   * `contextId` yields a fresh instance.
   *
   * @async
   * @param {InjectionToken} token - The injection token
   * @param {NormalizedProvider} provider - The normalized provider definition
   * @param {string} contextId - The context identifier
   * @returns {Promise<unknown>} The function returns a `Promise` that resolves
   *          into the instance when fulfilled.
   *
   * @internal
   */
  private async resolveTransientWithContext(
    token: InjectionToken,
    provider: NormalizedProvider,
    contextId: string,
  ): Promise<unknown> {
    let contextCache = this.contexts.get(contextId);

    if (!contextCache) {
      contextCache = new Map();
      this.contexts.set(contextId, contextCache);
    }

    if (contextCache.has(token)) {
      return contextCache.get(token);
    }

    this.resolving.add(token);

    try {
      const instance = await provider.resolve(this);

      contextCache.set(token, instance);
      this.instances.push(instance);

      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }

  /**
   * Resolves a provider according to its configured mode within a context.
   *
   * Transient providers are cached per `contextId`. All other modes delegate
   * to their standard resolution strategy.
   *
   * @async
   * @param {InjectionToken} token - The injection token associated with the provider
   * @param {NormalizedProvider} provider - The normalized provider definition
   * @param {string} contextId - The context identifier
   * @returns {Promise<unknown>} The function returns a `Promise` that resolves into
   *          the instantiated value when fulfilled.
   *
   * @internal
   */
  private resolveWithModeInContext(
    token: InjectionToken,
    provider: NormalizedProvider,
    contextId: string,
  ): Promise<unknown> {
    switch (provider.mode) {
      case "singleton":
        return this.resolveSingleton(token, provider);

      case "transient":
        return this.resolveTransientWithContext(token, provider, contextId);

      case "request":
        return this.resolveRequest(token, provider);

      default:
        return this.resolveTransientWithContext(token, provider, contextId);
    }
  }

  /**
   * Resolve a dependency by its token within a named context.
   *
   * Follows the same resolution order as {@linkcode resolve}:
   * 1. Own providers
   * 2. Exported providers from child containers (imported modules)
   * 3. Global providers
   *
   * Transient providers are cached per `contextId` - the same `contextId`
   * returns the same instance, while a different `contextId` produces a fresh one.
   * All other modes use their standard caching strategy.
   *
   * @async
   * @template T - The resolved return type
   * @param {InjectionToken<T>} token - The provider token
   * @param {string} contextId - The context identifier for transient caching
   * @returns {Promise<T>} The function returns a `Promise` that resolves into
   *          the instantiated value when fulfilled.
   * @throws {CircularDependencyError}
   * @throws {TokenNotFoundError}
   * @throws {RequestContextError}
   */
  public async resolveWithContext<T>(
    token: InjectionToken<T>,
    contextId: string,
  ): Promise<T> {
    if (this.resolving.has(token)) {
      throw new CircularDependencyError([...this.resolving, token]);
    }

    const provider = this.providers.get(token);

    if (provider) {
      return this.resolveWithModeInContext(
        token,
        provider,
        contextId,
      ) as Promise<T>;
    }

    for (const child of this.children) {
      if (child.isExported(token)) {
        try {
          return await child.resolveWithContext(token, contextId);
        } catch (e) {
          if (!(e instanceof TokenNotFoundError)) {
            const err = e as Error;

            this.logger.error(
              `Failed to resolve ${serializeToken(token)}: ${err.message}`,
              err.stack,
            );

            throw err;
          }
        }
      }
    }

    if (this.globalContainer && this.globalContainer !== this) {
      if (this.globalContainer.has(token)) {
        return this.globalContainer.resolveWithContext(token, contextId);
      }
    }

    throw new TokenNotFoundError(token);
  }

  /**
   * Resolve a request-scoped provider. The lifetime of this provider
   * is **not** tied to the application lifecycle. They're created for
   * each request and garbage-collected after.
   *
   * @note Lifecycle hooks (`onModuleInit`, `onModuleDestroy`, etc.) **do not** apply.
   *
   * @async
   * @param {InjectionToken} token
   * @param {NormalizedProvider} provider
   * @returns {Promise<unknown>}
   *
   * @internal
   */
  private async resolveRequest(
    token: InjectionToken,
    provider: NormalizedProvider,
  ): Promise<unknown> {
    const context = getRequestContext();

    if (!context) {
      throw new RequestContextError(token);
    }

    if (context.instances.has(token)) {
      return context.instances.get(token);
    }

    this.resolving.add(token);
    try {
      const instance = await provider.resolve(this);

      context.instances.set(token, instance);

      /**
       * @note **NOT** adding this to `this.instances` because request-scoped
       *       instances are garbage collected when the request context ends
       */
      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }

  /**
   * Get tagged providers that are exported (for parent container use).
   *
   * @async
   * @template T - The return type used for **all** matches
   * @param {Tag} tag - The searchable tag
   * @returns {Promise<T[]>} The function returns a `Promise` that resolves into `T[]`
   *          when fulfilled.
   *
   * @internal
   */
  private async getExportedByTag<T = unknown>(
    tag: Tag,
    contextId?: string,
  ): Promise<T[]> {
    const instances: T[] = [];
    const tokens = this.tagToTokens.get(tag);

    if (tokens) {
      for (const token of tokens) {
        if (this.isExported(token)) {
          try {
            const instance = contextId
              ? await this.resolveWithContext(token, contextId)
              : await this.resolve(token);

            instances.push(instance as T);
          } catch (e) {
            if (!(e instanceof TokenNotFoundError)) {
              const err = e as Error;

              this.logger.error(
                `Failed to resolve exported "${
                  serializeToken(token)
                }" with tag "${String(tag)}": ${err.message}`,
                err.stack,
              );

              throw err;
            }
          }
        }
      }
    }

    return instances;
  }
}
