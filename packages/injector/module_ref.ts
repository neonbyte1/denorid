import { serializeToken } from "./_internal.ts";
import type { InjectionToken, Tag, Type } from "./common.ts";
import type { Container } from "./container.ts";

/**
 * Interface to control the instance resolution within a {@linkcode ModuleRef} instance.
 */
export interface ModuleRefOptions {
  /**
   * The default behaviour when resolving any instance via {@linkcode ModuleRef} is strict,
   * which means you're trying to resolve a provider registered within the current module scope.
   * You need to set `strict` to `false` if you want to resolve tokens from the whole application.
   *
   * @default true
   */
  strict?: boolean;
}

/**
 * Extends {@linkcode ModuleRefOptions} with a required context identifier,
 * scoping instance resolution to a specific request or execution context.
 */
export interface ModuleRefContextOptions extends ModuleRefOptions {
  /**
   * The context identifier used to scope instance resolution.
   * Providers resolved with the same `contextId` share the same instance within that context.
   */
  contextId: string;
}

/**
 * Provides dynamic access to the dependency injection container.
 *
 * @note This **must** be injected via constructor (not `@Inject`) to get the module scope.
 *
 * @example
 * ```ts
 * @Injectable()
 * class MyService {
 *   constructor(private moduleRef: ModuleRef) {}
 *
 *   async doSomething() {
 *     // Resolve only within module scope (default)
 *     const logger = await this.moduleRef.get(Logger);
 *
 *     // Resolve from the whole application container
 *     const localService = await this.moduleRef.get(LocalService, { strict: false });
 *   }
 * }
 * ```
 */
export class ModuleRef {
  public constructor(
    private readonly container: Container,
    private readonly rootContainer: Container,
    private readonly moduleTokens: Set<InjectionToken>,
  ) {}

  /**
   * Resolve a provider by its token.
   *
   * @template T The resolved instance type.
   * @param {InjectionToken} token - The injection token to resolve.
   * @param {ModuleRefOptions|undefined} options - Optional resolution options.
   * @returns {Promise<T>} The function returns a `Promise` that resolves into the provider instance.
   *
   * @throws {TokenNotFoundError} if the token is not found.
   * @throws {Error} if `strict` is `true` and the token is not in the current module's scope.
   */
  public get<T>(
    token: InjectionToken<T>,
    options?: ModuleRefOptions,
  ): Promise<T>;
  /**
   * Resolve a provider by its token within a given context.
   *
   * @template T The resolved instance type.
   * @param {InjectionToken} token - The injection token to resolve.
   * @param {ModuleRefContextOptions} options - Resolution options including a required `contextId`
   *        to scope the resolution to a specific request or execution context.
   * @returns {Promise<T>} The function returns a `Promise` that resolves into the provider instance
   *          bound to the given context.
   *
   * @throws {TokenNotFoundError} if the token is not found.
   * @throws {Error} if `strict` is `true` and the token is not in the current module's scope.
   */
  public get<T>(
    token: InjectionToken<T>,
    options: ModuleRefContextOptions,
  ): Promise<T>;
  public get<T>(
    token: InjectionToken<T>,
    options?: ModuleRefOptions | ModuleRefContextOptions,
  ): Promise<T> {
    {
      const strict = options?.strict ?? true;

      if (strict && !this.moduleTokens.has(token)) {
        throw new Error(
          `Token "${
            serializeToken(token)
          }" is not available in this module's scope. ` +
            `Use { strict: false } to resolve from the whole application.`,
        );
      }

      const container = !strict && !this.moduleTokens.has(token)
        ? this.rootContainer
        : this.container;

      return options && "contextId" in options
        ? container.resolveWithContext(token, options.contextId)
        : container.resolve(token);
    }
  }

  /**
   * Try to resolve a provider by its token, returning `undefined` if not found.
   *
   * @template T The resolved instance type.
   * @param {InjectionToken} token - The injection token to resolve.
   * @param {ModuleRefOptions|undefined} options - Optional resolution options.
   * @returns {Promise<T|undefined>} The function returns a `Promise` that resolves into
   *          `T` when the token is found, or `undefined` otherwise.
   */
  public tryGet<T>(
    token: InjectionToken<T>,
    options?: ModuleRefOptions,
  ): Promise<T | undefined>;
  /**
   * Try to resolve a provider by its token within a given context, returning `undefined` if not found.
   *
   * @template T The resolved instance type.
   * @param {InjectionToken} token - The injection token to resolve.
   * @param {ModuleRefContextOptions} options - Resolution options including a required `contextId`
   *        to scope the resolution to a specific request or execution context.
   * @returns {Promise<T|undefined>} The function returns a `Promise` that resolves into
   *          `T` when the token is found within the context, or `undefined` otherwise.
   */
  public tryGet<T>(
    token: InjectionToken<T>,
    options: ModuleRefContextOptions,
  ): Promise<T | undefined>;
  public async tryGet<T>(
    token: InjectionToken<T>,
    options?: ModuleRefOptions | ModuleRefContextOptions,
  ): Promise<T | undefined> {
    try {
      return await this.get(token, options);
    } catch {
      return undefined;
    }
  }

  /**
   * Check if a token is available in the current module's scope.
   *
   * @param {InjectionToken} token - The injection token to resolve
   * @returns {boolean} The function returns `true` when this module contains
   *          the `token`, otherwise `false`.
   */
  public has(token: InjectionToken): boolean {
    return this.moduleTokens.has(token);
  }

  /**
   * Check if a token is available from the whole application container.
   *
   * @param {InjectionToken} token - The injection token to resolve
   * @returns {boolean} The function returns `true` when the application container
   *          contains the `token`, otherwise `false`.
   */
  public hasGlobal(token: InjectionToken): boolean {
    return this.rootContainer.canResolve(token);
  }

  /**
   * Resolve all providers with a specific tag.
   *
   * @template T The instance type. Note: this type will be used for **all** instances.
   * @param {Tag} tag - The tag to search for.
   * @param {ModuleRefOptions|undefined} options - Optional resolution options.
   * @returns {Promise<T[]>} The function returns a `Promise` that resolves into an
   *          array of resolved instances.
   *
   * @example
   * ```ts
   * const validators = await this.moduleRef.getByTag(VALIDATOR);
   * for (const validator of validators) {
   *   validator.validate(input);
   * }
   * ```
   */
  public getByTag<T = unknown>(
    tag: Tag,
    options?: ModuleRefOptions,
  ): Promise<T[]>;
  /**
   * Resolve all providers with a specific tag within a given context.
   *
   * @template T The instance type. Note: this type will be used for **all** instances.
   * @param {Tag} tag - The tag to search for.
   * @param {ModuleRefContextOptions} options - Resolution options including a required `contextId`
   *        to scope the resolution to a specific request or execution context.
   * @returns {Promise<T[]>} The function returns a `Promise` that resolves into an
   *          array of resolved instances bound to the given context.
   *
   * @example
   * ```ts
   * const validators = await this.moduleRef.getByTag(VALIDATOR, { contextId });
   * for (const validator of validators) {
   *   validator.validate(input);
   * }
   * ```
   */
  public getByTag<T = unknown>(
    tag: Tag,
    options: ModuleRefContextOptions,
  ): Promise<T[]>;
  public async getByTag<T = unknown>(
    tag: Tag,
    options?: ModuleRefOptions | ModuleRefContextOptions,
  ): Promise<T[]> {
    const strict = options?.strict ?? true;
    const contextId = options && "contextId" in options
      ? options.contextId
      : undefined;

    if (!strict) {
      return await this.rootContainer.getByTag<T>(tag, contextId);
    }

    const tokens = this.container
      .getTokensByTag(tag, true)
      .filter((token) => this.moduleTokens.has(token));
    const instances: T[] = [];

    for (const token of tokens) {
      const instance = contextId
        ? await this.container.resolveWithContext(token, contextId)
        : await this.container.resolve(token);

      instances.push(instance as T);
    }

    return instances;
  }

  /**
   * Get all provider tokens registered with a specific tag.
   *
   * @param {Tag} tag - The tag to search for.
   * @param {ModuleRefOptions|undefined} options - Optional lookup options.
   * @returns {InjectionToken[]} The function returns an array of provider tokens
   *          registered with the requested tag.
   *
   * @example
   * ```ts
   * const validatorTokens = this.moduleRef.getTokensByTag(VALIDATOR);
   * const appValidatorTokens = this.moduleRef.getTokensByTag(VALIDATOR, {
   *   strict: false,
   * });
   * ```
   */
  public getTokensByTag<T extends InjectionToken = InjectionToken>(
    tag: Tag,
    options?: ModuleRefOptions,
  ): T[] {
    const strict = options?.strict ?? true;

    if (!strict) {
      return this.rootContainer.getTokensByTag(tag) as T[];
    }

    return this.container
      .getTokensByTag(tag, true)
      .filter((token) => this.moduleTokens.has(token)) as T[];
  }

  /**
   * Create a new instance of a class, injecting its dependencies.
   *
   * @note The class does not need to be registered as a provider.
   *
   * @template T - The actual class type
   * @param {Type<T>} target - The constructable class
   * @returns {Promise<T>} The function returns a `Promise` that resolves into
   *          the instantiated class `T`.
   */
  public create<T>(target: Type<T>): Promise<T> {
    return this.container.instantiateClass(target);
  }
}
