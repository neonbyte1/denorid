import { type Decorator, Inject } from "@denorid/injector";
import { CACHE_MANAGER } from "./_constants.ts";

/**
 * Field decorator that injects the cache-manager `Cache` instance.
 *
 * Shorthand for `@Inject(CACHE_MANAGER)`.
 *
 * @return {Decorator<ClassFieldDecoratorContext>} A class field decorator.
 *
 * @example
 * ```ts
 * @Injectable()
 * class UserService {
 *   @InjectCache()
 *   private readonly cache!: Cache;
 * }
 * ```
 */
export const InjectCache = (): Decorator<ClassFieldDecoratorContext> =>
  Inject(CACHE_MANAGER);
