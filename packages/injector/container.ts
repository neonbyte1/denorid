import type { LoggerService } from "@denorid/logger";
import { AsyncLocalStorage } from "node:async_hooks";
import { recordCreation } from "./_creation_order.ts";
import {
  getInjectionDependencies,
  getTags,
  serializeToken,
} from "./_internal.ts";
import { getCurrentModuleRef, getModuleRefOf } from "./_module_context.ts";
import {
  type NormalizedFactoryProvider,
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
import {
  getProviderToken,
  isClassProvider,
  type Provider,
} from "./provider.ts";

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
 * A provider as registered in a container. Its identity keys every cache, so
 * two containers registering the same token never share instances.
 *
 * @internal
 */
interface Registration {
  /**
   * The normalized provider.
   */
  readonly provider: NormalizedProvider;

  /**
   * The container resolving the provider's dependencies (or alias target).
   */
  readonly scope: Container;
}

/**
 * The in-flight resolution of a registration, one step of a resolution chain.
 *
 * @internal
 */
interface Frame {
  /**
   * The registration being resolved.
   */
  readonly registration: Registration;

  /**
   * The resolution that requested this one. Cleared once settled.
   */
  parent: Frame | undefined;

  /**
   * In-flight resolutions this one awaits: its dependencies and the shared
   * resolutions it joined.
   */
  readonly waits: Set<Frame>;

  /**
   * Settles with the resolved value.
   */
  readonly promise: Promise<unknown>;

  /**
   * Whether the resolution settled.
   */
  done: boolean;
}

/**
 * A cache of resolutions, settled or in flight, per registration.
 *
 * @internal
 */
type ResolutionCache = Map<Registration, Frame>;

/**
 * The resolution chain of the calling code: the innermost in-flight frame.
 *
 * @internal
 */
const chains = new AsyncLocalStorage<Frame>();

/**
 * A lookup of effective modes (see `Container.effectiveMode`).
 *
 * @internal
 */
interface ModeQuery {
  /**
   * The registrations being looked up, outermost first (stops cycles).
   */
  readonly path: Set<Registration>;

  /**
   * Whether the lookup has not met a cycle yet. Modes computed after a cycle
   * may miss a request-scoped dependency and are not memoized.
   */
  complete: boolean;
}

/**
 * Version of the provider graph of all containers, bumped whenever a
 * registration, an import or an export changes. Invalidates memoized modes.
 *
 * @internal
 */
let graphVersion = 0;

/**
 * Memoized effective modes per registration, with the graph version they
 * were computed for.
 *
 * @internal
 */
const effectiveModes = new WeakMap<
  Registration,
  { readonly version: number; readonly mode: InjectableMode }
>();

/**
 * Lists the tokens of a resolution chain, outermost first. A frame directly
 * forwarding to the same token (global module providers) is listed once.
 *
 * @param {Frame|undefined} frame - The innermost frame of the chain
 * @returns {InjectionToken[]} The tokens of the chain.
 *
 * @internal
 */
function chainOf(frame: Frame | undefined): InjectionToken[] {
  const tokens: InjectionToken[] = [];

  for (let step = frame; step && !step.done; step = step.parent) {
    const { token } = step.registration.provider;

    if (tokens[0] !== token) {
      tokens.unshift(token);
    }
  }

  return tokens;
}

/**
 * Returns the frame of the calling resolution chain, after making sure the
 * chain is not resolving `registration` already.
 *
 * @param {Registration} registration - The registration about to be resolved
 * @returns {Frame|undefined} The innermost in-flight frame of the calling
 *          chain, `undefined` outside of a resolution.
 * @throws {CircularDependencyError} If the chain resolves `registration` already.
 *
 * @internal
 */
function enterChain(registration: Registration): Frame | undefined {
  const store = chains.getStore();
  const current = store?.done ? undefined : store;

  for (let step = current; step && !step.done; step = step.parent) {
    if (step.registration === registration) {
      throw new CircularDependencyError([
        ...chainOf(current),
        registration.provider.token,
      ]);
    }
  }

  return current;
}

/**
 * Finds a path of awaited resolutions from `from` to `to`.
 *
 * @param {Frame} from - The frame to start at
 * @param {Frame} to - The frame to reach
 * @returns {Frame[]|undefined} The frames from `from` to `to` (inclusive), or
 *          `undefined` when `from` does not wait for `to`.
 *
 * @internal
 */
function findWaitPath(from: Frame, to: Frame): Frame[] | undefined {
  if (from === to) {
    return [from];
  }

  for (const next of from.waits) {
    const path = findWaitPath(next, to);

    if (path) {
      return [from, ...path];
    }
  }

  return undefined;
}

/**
 * Waits for an in-flight resolution started by another chain.
 *
 * @param {Frame|undefined} current - The frame of the calling chain
 * @param {Frame} target - The in-flight resolution to wait for
 * @returns {Promise<unknown>} Settles with the resolution of `target`.
 * @throws {CircularDependencyError} If `target` (transitively) waits for the
 *         calling chain, which would never settle.
 *
 * @internal
 */
async function join(
  current: Frame | undefined,
  target: Frame,
): Promise<unknown> {
  if (!current) {
    return await target.promise;
  }

  const cycle = findWaitPath(target, current);

  if (cycle) {
    throw new CircularDependencyError([
      ...chainOf(current),
      ...cycle.map((frame) => frame.registration.provider.token),
    ]);
  }

  current.waits.add(target);

  try {
    return await target.promise;
  } finally {
    current.waits.delete(target);
  }
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
  private providers = new Map<InjectionToken, Registration>();
  private singletons: ResolutionCache = new Map();

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
   * All singletons created by this container (for lifecycle management).
   */
  private instances: unknown[] = [];

  /**
   * Singletons this container created through class and factory providers,
   * disposed on shutdown (see {@linkcode getOwnedInstances}).
   */
  private owned = new Set<unknown>();

  /**
   * Mapping to collect all tokens for specified tags.
   */
  private tagToTokens = new Map<Tag, Set<InjectionToken>>();

  /**
   * Per-context instance caches for context-scoped transient resolution.
   */
  private contexts = new Map<string, ResolutionCache>();

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
      this.addProvider(provider, normalizeProvider(provider), this);
    }

    return this;
  }

  /**
   * Register providers whose dependencies are resolved from `scope` instead of
   * this container. Instances are still cached and tracked by this container.
   *
   * Used for the providers of global module variants that have no module
   * container of their own: the global container holds them, while their
   * dependencies may come from the module's imports.
   *
   * @param {Container} scope - Container resolving the providers' dependencies.
   * @param {...Provider[]} providers - Providers passed as rest arguments
   * @returns {Container} Reference to `this` object.
   */
  public registerScoped(scope: Container, ...providers: Provider[]): this {
    for (const provider of providers) {
      this.addProvider(provider, normalizeProvider(provider), scope);
    }

    return this;
  }

  /**
   * Register providers that `target` resolves: every resolution of their
   * tokens through this container (including a `contextId`) is forwarded to
   * `target`, which creates, caches and tracks the instances. The providers
   * keep their tags in this container, so its tag lookups find them.
   *
   * Used for the providers of global modules: the global container exposes
   * them without creating a second instance.
   *
   * @param {Container} target - Container providing the instances.
   * @param {...Provider[]} providers - Providers passed as rest arguments
   * @returns {Container} Reference to `this` object.
   */
  public registerForwarded(target: Container, ...providers: Provider[]): this {
    for (const provider of providers) {
      const token = getProviderToken(provider);

      this.addProvider(provider, { token, existing: token }, target);
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
    graphVersion++;

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
    graphVersion++;

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
   * Get the effective mode ({@linkcode InjectableMode}) of a provider: its
   * declared mode, or `"request"` when it (transitively) depends on a
   * request-scoped provider (scope bubbling). An alias (`useExisting`)
   * reports the mode of its target.
   *
   * @param {InjectionToken} token - The provider token
   * @returns {InjectableMode|undefined} The function returns the mode as `string`
   *          if the provider was found, otherwise `undefined`.
   */
  public getProviderMode(token: InjectionToken): InjectableMode | undefined {
    return this.modeOf(token, { path: new Set(), complete: true });
  }

  /**
   * Check if a token is request-scoped, declared or through one of its
   * dependencies (see {@linkcode getProviderMode}).
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
   * Concurrent resolutions of the same singleton (or request-scoped provider
   * within one request) share one instance.
   *
   * @async
   * @template T - The resolved return type
   * @param {InjectionToken} token - The provider token
   * @returns {Promise<T>} The function returns a `Promise` that resolves into
   *          the instantiated value when fulfilled.
   * @throws {CircularDependencyError}
   * @throws {TokenNotFoundError}
   * @throws {RequestContextError}
   */
  public resolve<T>(token: InjectionToken<T>): Promise<T> {
    return this.lookup(token, undefined) as Promise<T>;
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
  public resolveWithContext<T>(
    token: InjectionToken<T>,
    contextId: string,
  ): Promise<T> {
    return this.lookup(token, contextId) as Promise<T>;
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
   * Resolve all providers with a specific tag that are visible in this
   * container: own, exported by imported modules and global ones (see
   * {@linkcode getTokensByTag}). Tokens that cannot be resolved are skipped.
   *
   * @async
   * @param {Tag} tag - The tag to search for
   * @param {string|undefined} contextId - Optional context identifier for
   *        per-context transient caching
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

    for (const token of this.getTokensByTag(tag)) {
      try {
        instances.push(await this.lookup(token, contextId) as T);
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

    return instances;
  }

  /**
   * Get all tokens registered with a specific tag (without resolving),
   * deduplicated: own tokens, tokens of imported modules and global tokens.
   *
   * Imported modules contribute the tokens they export (including tokens
   * they re-export from their own imports). With `bypassExportCheck` every
   * tagged token of every (transitively) imported module is included.
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
    const tokens = new Set(
      this.collectTagged(tag, bypassExportCheck ?? false, new Map()),
    );

    if (this.globalContainer && this.globalContainer !== this) {
      for (const token of this.globalContainer.tagToTokens.get(tag) ?? []) {
        tokens.add(token);
      }
    }

    return [...tokens];
  }

  /**
   * Instantiate a class and inject its dependencies.
   *
   * @note The class receives the {@linkcode ModuleRef} of the module this
   *       container belongs to as first constructor argument. A container
   *       without a module falls back to the module context (see
   *       {@linkcode runInModuleContext}), if any.
   *
   * @template T - The actual class type
   * @param {Type<T>} target - The constructable class `T`
   *
   * @returns {Promise<T>} The function returns a `Promise` that resolves into `T`
   *          when fulfilled.
   *          The resolved value is the instantiated class with its dependencies.
   */
  public async instantiateClass<T>(target: Type<T>): Promise<T> {
    const moduleRef = getModuleRefOf(this) ?? getCurrentModuleRef();
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
   * Get all singletons created by this container if no `options` are used or
   * {@linkcode RecursiveResolutionOption.recursive} is set to `false`. Otherwise
   * get all singletons from this container and all children (imported modules).
   *
   * @note Transient and request-scoped instances belong to their consumer and
   *       are never listed.
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
   * Get the singletons this container created itself through class and
   * factory providers, as opposed to values (`useValue`) it was handed. The
   * container owns these instances and disposes them on shutdown.
   *
   * @param {RecursiveResolutionOption|undefined} options - Optional resolution option.
   * @returns {unknown[]} The owned instances in creation order, including
   *          those of all children (imported modules) when `recursive` is set.
   */
  public getOwnedInstances(options?: RecursiveResolutionOption): unknown[] {
    const instances = [...this.owned];

    if (options?.recursive) {
      for (const child of this.children) {
        instances.push(...child.getOwnedInstances(options));
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
    graphVersion++;
    // New maps: resolutions still in flight keep evicting from the old ones.
    this.singletons = new Map();
    this.instances = [];
    this.owned.clear();
    this.tagToTokens.clear();
    this.contexts = new Map();
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
   * Stores a provider registration and maps the tags of its class.
   *
   * @param {Provider} provider - The provider as passed by the caller
   * @param {NormalizedProvider} normalized - The normalized provider
   * @param {Container} scope - The container resolving its dependencies
   *
   * @internal
   */
  private addProvider(
    provider: Provider,
    normalized: NormalizedProvider,
    scope: Container,
  ): void {
    this.providers.set(normalized.token, { provider: normalized, scope });
    graphVersion++;

    const targetClass = this.getProviderClass(provider);

    if (targetClass) {
      this.mapTagsToTokens(targetClass, normalized.token);
    }
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
   * Maps all tags of `target` to a provider token.
   *
   * @param {Type} target - The constructable target class
   * @param {InjectionToken} token - The provider token
   *
   * @internal
   */
  private mapTagsToTokens(target: Type, token: InjectionToken): void {
    for (const tag of getTags(target)) {
      let mapping = this.tagToTokens.get(tag);

      if (!mapping) {
        mapping = new Set();

        this.tagToTokens.set(tag, mapping);
      }

      mapping.add(token);
    }
  }

  /**
   * Collects the tokens tagged with `tag` that are visible in this container:
   * own tokens plus the tokens its imports export (or all of their tokens
   * when `all` is set), recursively.
   *
   * @param {Tag} tag - The searchable tag
   * @param {boolean} all - Whether to include tokens imports do not export
   * @param {Map<Container, Set<InjectionToken>>} memo - Results per container
   *        of the current lookup (shared imports are collected once)
   * @returns {Set<InjectionToken>} The visible tagged tokens.
   *
   * @internal
   */
  private collectTagged(
    tag: Tag,
    all: boolean,
    memo: Map<Container, Set<InjectionToken>>,
  ): Set<InjectionToken> {
    let tokens = memo.get(this);

    if (tokens) {
      return tokens;
    }

    tokens = new Set(this.tagToTokens.get(tag));
    memo.set(this, tokens);

    for (const child of this.children) {
      for (const token of child.collectTagged(tag, all, memo)) {
        if (all || child.isExported(token)) {
          tokens.add(token);
        }
      }
    }

    return tokens;
  }

  /**
   * Get the effective mode of the provider `token` resolves to, looked up
   * like {@linkcode lookup} does: own providers, then exported providers of
   * child containers, then global providers.
   *
   * @param {InjectionToken} token - The provider token
   * @param {ModeQuery} query - The running lookup
   * @returns {InjectableMode|undefined} The mode, or `undefined` if the
   *          provider (or an alias target) was not found.
   *
   * @internal
   */
  private modeOf(
    token: InjectionToken,
    query: ModeQuery,
  ): InjectableMode | undefined {
    const registration = this.providers.get(token);

    if (registration) {
      const { provider, scope } = registration;

      if (!("existing" in provider)) {
        return Container.effectiveMode(registration, provider, query);
      }

      if (query.path.has(registration)) {
        query.complete = false;

        return undefined;
      }

      query.path.add(registration);

      const mode = scope.modeOf(provider.existing, query);

      query.path.delete(registration);

      return mode;
    }

    for (const child of this.children) {
      if (child.isExported(token)) {
        const mode = child.modeOf(token, query);

        if (mode) {
          return mode;
        }
      }
    }

    if (this.globalContainer && this.globalContainer !== this) {
      return this.globalContainer.modeOf(token, query);
    }

    return undefined;
  }

  /**
   * Get the effective mode of a registration: `"request"` when the provider
   * is request-scoped or one of its dependencies (looked up from its scope)
   * is, transitively; its declared mode otherwise. Memoized per registration
   * until the provider graph changes.
   *
   * @note A dependency cycle adds nothing to the mode: resolving it fails
   *       with a {@linkcode CircularDependencyError} anyway.
   *
   * @param {Registration} registration - The registration
   * @param {NormalizedFactoryProvider} provider - Its (non-alias) provider
   * @param {ModeQuery|undefined} query - The running lookup, if any
   * @returns {InjectableMode} The effective mode.
   *
   * @internal
   */
  private static effectiveMode(
    registration: Registration,
    provider: NormalizedFactoryProvider,
    query?: ModeQuery,
  ): InjectableMode {
    if (provider.mode === "request") {
      return "request";
    }

    const memo = effectiveModes.get(registration);

    if (memo?.version === graphVersion) {
      return memo.mode;
    }

    const running = query ?? { path: new Set(), complete: true };

    if (running.path.has(registration)) {
      running.complete = false;

      return provider.mode;
    }

    running.path.add(registration);

    const bubbled = provider.dependencies.some((token) =>
      registration.scope.modeOf(token, running) === "request"
    );

    running.path.delete(registration);

    const mode = bubbled ? "request" : provider.mode;

    if (running.complete) {
      effectiveModes.set(registration, { version: graphVersion, mode });
    }

    return mode;
  }

  /**
   * Resolves a token: own providers, then exported providers of child
   * containers, then global providers.
   *
   * @param {InjectionToken} token - The provider token
   * @param {string|undefined} contextId - The context identifier for
   *        per-context transient caching, if any
   * @returns {Promise<unknown>} Resolves into the instance when fulfilled.
   *
   * @internal
   */
  private async lookup(
    token: InjectionToken,
    contextId: string | undefined,
  ): Promise<unknown> {
    const registration = this.providers.get(token);

    if (registration) {
      return await this.resolveRegistration(registration, contextId);
    }

    for (const child of this.children) {
      if (child.isExported(token)) {
        try {
          return await child.lookup(token, contextId);
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
        return await this.globalContainer.lookup(token, contextId);
      }
    }

    throw new TokenNotFoundError(token);
  }

  /**
   * Resolves a registration according to its effective mode (see
   * {@linkcode getProviderMode}):
   * - alias: resolves the target every time.
   * - `"singleton"`: one instance per registration, tracked for lifecycle
   *   hooks and disposal.
   * - `"request"` (declared or bubbled up from a dependency): one instance
   *   per registration and request; lifecycle hooks **do not** apply.
   * - `"transient"` (and unknown modes): a new instance every time, one per
   *   registration and `contextId` when resolved within a context; lifecycle
   *   hooks **do not** apply.
   *
   * @param {Registration} registration - The registration to resolve
   * @param {string|undefined} contextId - The context identifier, if any
   * @returns {Promise<unknown>} Resolves into the instance when fulfilled.
   * @throws {RequestContextError} For a request-scoped provider outside of a
   *         request context.
   *
   * @internal
   */
  private async resolveRegistration(
    registration: Registration,
    contextId: string | undefined,
  ): Promise<unknown> {
    const { provider } = registration;

    if ("existing" in provider) {
      return await this.resolveUncached(registration, contextId);
    }

    switch (Container.effectiveMode(registration, provider)) {
      case "singleton":
        return await this.resolveCached(
          this.singletons,
          registration,
          contextId,
          provider,
        );

      case "request": {
        const context = getRequestContext();

        if (!context) {
          throw new RequestContextError(provider.token);
        }

        return await this.resolveCached(
          context.instances as ResolutionCache,
          registration,
          contextId,
        );
      }

      default: {
        if (contextId === undefined) {
          return await this.resolveUncached(registration, contextId);
        }

        let cache = this.contexts.get(contextId);

        if (!cache) {
          cache = new Map();

          this.contexts.set(contextId, cache);
        }

        return await this.resolveCached(cache, registration, contextId);
      }
    }
  }

  /**
   * Resolves a registration once per `cache`: concurrent callers share the
   * in-flight resolution, a failed resolution is evicted.
   *
   * @param {ResolutionCache} cache - The cache holding the resolution
   * @param {Registration} registration - The registration to resolve
   * @param {string|undefined} contextId - The context identifier, if any
   * @param {NormalizedFactoryProvider|undefined} tracked - The provider to
   *        track the instance for, `undefined` to leave it untracked
   * @returns {Promise<unknown>} Resolves into the instance when fulfilled.
   *
   * @internal
   */
  private async resolveCached(
    cache: ResolutionCache,
    registration: Registration,
    contextId: string | undefined,
    tracked?: NormalizedFactoryProvider,
  ): Promise<unknown> {
    const cached = cache.get(registration);

    if (cached?.done) {
      return await cached.promise;
    }

    const current = enterChain(registration);

    if (cached) {
      return await join(current, cached);
    }

    return await this.start(registration, current, contextId, cache, tracked)
      .promise;
  }

  /**
   * Resolves a registration without caching the result.
   *
   * @param {Registration} registration - The registration to resolve
   * @param {string|undefined} contextId - The context identifier, if any
   * @returns {Promise<unknown>} Resolves into the instance when fulfilled.
   *
   * @internal
   */
  private async resolveUncached(
    registration: Registration,
    contextId: string | undefined,
  ): Promise<unknown> {
    const current = enterChain(registration);

    return await this.start(registration, current, contextId).promise;
  }

  /**
   * Starts resolving a registration as a new frame of the calling chain.
   *
   * @param {Registration} registration - The registration to resolve
   * @param {Frame|undefined} parent - The frame of the calling chain
   * @param {string|undefined} contextId - The context identifier, if any
   * @param {ResolutionCache|undefined} cache - The cache holding the
   *        resolution, if any
   * @param {NormalizedFactoryProvider|undefined} tracked - The provider to
   *        track the instance for, `undefined` to leave it untracked
   * @returns {Frame} The in-flight frame.
   *
   * @internal
   */
  private start(
    registration: Registration,
    parent: Frame | undefined,
    contextId: string | undefined,
    cache?: ResolutionCache,
    tracked?: NormalizedFactoryProvider,
  ): Frame {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const frame: Frame = {
      registration,
      parent,
      waits: new Set(),
      promise,
      done: false,
    };
    const settle = (): void => {
      frame.done = true;
      frame.parent?.waits.delete(frame);
      frame.parent = undefined;
    };

    parent?.waits.add(frame);
    cache?.set(registration, frame);

    chains.run(frame, () => this.create(registration, contextId)).then(
      (instance) => {
        if (tracked) {
          this.track(instance, tracked);
        }

        settle();
        resolve(instance);
      },
      (error: unknown) => {
        cache?.delete(registration);
        settle();
        reject(error);
      },
    );

    return frame;
  }

  /**
   * Creates the value of a registration: resolves the target of an alias
   * (forwarding the `contextId`) or runs the provider in its scope.
   *
   * @param {Registration} registration - The registration to resolve
   * @param {string|undefined} contextId - The context identifier, if any
   * @returns {Promise<unknown>} Resolves into the value when fulfilled.
   *
   * @internal
   */
  private async create(
    registration: Registration,
    contextId: string | undefined,
  ): Promise<unknown> {
    const { provider, scope } = registration;

    if ("existing" in provider) {
      return await scope.lookup(provider.existing, contextId);
    }

    return await provider.resolve(scope);
  }

  /**
   * Records a singleton for lifecycle hooks and, when the container created
   * it, for disposal.
   *
   * @param {unknown} instance - The resolved instance
   * @param {NormalizedFactoryProvider} provider - The provider it was resolved from
   *
   * @internal
   */
  private track(instance: unknown, provider: NormalizedFactoryProvider): void {
    this.instances.push(instance);

    if (provider.owned) {
      this.owned.add(instance);
    }

    recordCreation(instance);
  }
}
