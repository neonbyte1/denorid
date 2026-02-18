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
   * You need to set `strict` to `true` if you want to resolve tokens from other modules.
   *
   * @default true
   */
  strict?: boolean;
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
 *     // Resolve from entire container (default)
 *     const logger = await this.moduleRef.get(Logger);
 *
 *     // Resolve only within module scope (strict: false)
 *     const localService = await this.moduleRef.get(LocalService, { strict: false });
 *   }
 * }
 * ```
 */
export class ModuleRef {
  public constructor(
    private readonly container: Container,
    private readonly moduleTokens: Set<InjectionToken>,
  ) {}

  /**
   * Resolve a provider by its token.
   *
   * @template T The resolved instance type
   *
   * @param token - The injection token to resolve
   * @param options - Resolution options (strict: true by default)
   *
   * @returns {T} The resolved instance.
   *
   * @throws {TokenNotFoundError} if the token is not found
   * @throws {Error} if strict is false and token is not in module scope
   */
  public get<T>(
    token: InjectionToken<T>,
    options?: ModuleRefOptions,
  ): Promise<T> {
    const strict = options?.strict ?? true;

    if (!strict && !this.moduleTokens.has(token)) {
      throw new Error(
        `Token "${
          serializeToken(token)
        }" is not available in this module's scope. ` +
          `Use { strict: true } to resolve from the entire container.`,
      );
    }

    return this.container.resolve(token);
  }

  /**
   * Try to resolve a provider, returning `undefined` if not found.
   *
   * @template T The resolved instance type
   *
   * @param {InjectionToken} token - The injection token to resolve
   * @param {ModuleRefOptions|undefined} options - Resolution options
   *
   * @returns {Promise<T|undefined>} The function returns a `Promise` that resolves into
   *          `T | undefined` when fulfilled.
   */
  public async tryGet<T>(
    token: InjectionToken<T>,
    options?: ModuleRefOptions,
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
   * Check if a token is available in the entire container.
   *
   * @param {InjectionToken} token - The injection token to resolve
   * @returns {boolean} The function returns `true` when the global module container
   *          contains the `token`, otherwise `false`.
   */
  public hasGlobal(token: InjectionToken): boolean {
    return this.container.has(token);
  }

  /**
   * Resolve all providers with a specific tag.
   *
   * @template T The instance type. Note: this type will be used for **all** instances.
   * @param {Tag} tag - The tag to search for
   * @param {ModuleRefOptions|undefined} options - Optional resolution options
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
  public async getByTag<T = unknown>(
    tag: Tag,
    options?: ModuleRefOptions,
  ): Promise<T[]> {
    const strict = options?.strict ?? true;
    const allInstances = await this.container.getByTag<T>(tag);

    if (strict) {
      return allInstances;
    }

    const tokens = this.container.getTokensByTag(tag);
    const filteredInstances: T[] = [];

    for (let i = 0; i < tokens.length; ++i) {
      if (this.moduleTokens.has(tokens[i])) {
        filteredInstances.push(allInstances[i]);
      }
    }

    return filteredInstances;
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
