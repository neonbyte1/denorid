import {
  getInjectionDependencies,
  getTags,
  isClassProvider,
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
import type { Provider } from "./provider.ts";

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
   * Creates a new container instance.
   *
   * @param options - Optional container configuration (see {@linkcode ContainerOptions})
   */
  public constructor(options?: ContainerOptions) {
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
            throw e;
          }
          /** @todo: double check this case, right now we just continue searching for other children */
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
    } catch (error) {
      if (error instanceof TokenNotFoundError) {
        return undefined;
      }
      throw error;
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
  public async getByTag<T = unknown>(tag: Tag): Promise<T[]> {
    const instances: T[] = [];
    const ownTokens = this.tagToTokens.get(tag);

    if (ownTokens) {
      for (const token of ownTokens) {
        try {
          const instance = await this.resolve(token);

          instances.push(instance as T);
        } catch {
          /** @todo: double check - should we log these if resolution fails? */
        }
      }
    }

    for (const child of this.children) {
      instances.push(...(await child.getExportedByTag<T>(tag)));
    }

    if (this.globalContainer && this.globalContainer !== this) {
      const globalTokens = this.globalContainer.tagToTokens.get(tag);

      if (globalTokens) {
        for (const token of globalTokens) {
          try {
            const instance = await this.globalContainer.resolve(token);

            instances.push(instance as T);
          } catch {
            /** @todo: double check - should we log these if resolution fails? */
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
   * @returns {InjectionToken[]} The function returns an array of `InjectionToken`
   *          that have the requested tag.
   */
  public getTokensByTag(tag: Tag): InjectionToken[] {
    const result: InjectionToken[] = [];
    const ownTokens = this.tagToTokens.get(tag);

    if (ownTokens) {
      result.push(...ownTokens);
    }

    for (const child of this.children) {
      const childTokens = child.tagToTokens.get(tag);

      if (childTokens) {
        for (const token of childTokens) {
          if (child.isExported(token)) {
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

        (instance as Record<Tag, unknown>)[dep.field] = resolved;
      } catch (error) {
        if (dep.options?.optional && error instanceof TokenNotFoundError) {
          continue;
        }

        throw error;
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
    return new Container({
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
  private async getExportedByTag<T = unknown>(tag: Tag): Promise<T[]> {
    const instances: T[] = [];
    const tokens = this.tagToTokens.get(tag);

    if (tokens) {
      for (const token of tokens) {
        if (this.isExported(token)) {
          try {
            const instance = await this.resolve(token);

            instances.push(instance as T);
          } catch {
            /** @todo: double check - should we log these if resolution fails? */
          }
        }
      }
    }

    return instances;
  }
}
