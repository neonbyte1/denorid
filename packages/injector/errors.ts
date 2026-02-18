import { serializeToken } from "./_internal.ts";
import type { InjectionToken } from "./common.ts";

/**
 * Base class for all injection-related errors.
 */
export class InjectionError extends Error {
  /**
   * @param {string} message - The error message
   */
  public constructor(message: string) {
    super(message);

    this.name = "InjectionError";
  }
}

/**
 * Error thrown when a circular dependency is detected.
 */
export class CircularDependencyError extends InjectionError {
  /**
   * @param {InjectionToken[]} chain - The chain of tokens invloved in the circular dependency
   */
  public constructor(public readonly chain: InjectionToken[]) {
    const tokenNames = chain.map(serializeToken);

    super(`Circular dependency detected: ${tokenNames.join(" -> ")}`);

    this.name = "CircularDependencyError";
  }
}

/**
 * Error thrown when no provider is found for a given token.
 */
export class TokenNotFoundError extends InjectionError {
  /**
   * @param {InjectionToken} token - The token that couldn't be resolved.
   */
  public constructor(public readonly token: InjectionToken) {
    super(`No provider found for token: ${serializeToken(token)}`);

    this.name = "TokenNotFoundError";
  }
}

/**
 * Error thrown when a moduel failes to compile.
 */
export class ModuleCompilationError extends InjectionError {
  /**
   * @param {string} message - The error message
   */
  public constructor(message: string) {
    super(message);

    this.name = "ModuleCompilationError";
  }
}

/**
 * Error thrown when a request-scoped provider is resolved outside of a request context.
 */
export class RequestContextError extends InjectionError {
  /**
   * @param {InjectionToken} token - The token being resolved outside of request scope
   */
  public constructor(token: InjectionToken) {
    super(
      `Cannot resolve request-scoped provider "${
        serializeToken(token)
      }" outside of a request context. ` +
        `Use container.runInRequestScope() to establish a request context.`,
    );

    this.name = "RequestContextError";
  }
}

/**
 * Error thrown when one or more lifecycle hooks fail during a specific phase.
 *
 * @note Throwing them directly would may lead to leaking memory duo to a crashed process.
 */
export class LifecycleError extends InjectionError {
  /**
   * @param {string} phase - The lifecycle phase (e.g. "onModuleInit", "onModuleDestroy", etc.)
   * @param {Error[]} errors - The array of errors that occurred
   */
  public constructor(
    public readonly phase: string,
    public readonly errors: Error[],
  ) {
    const messages = errors.map((e, i) => `  ${i + 1}. ${e.message}`).join(
      "\n",
    );

    super(`${errors.length} error(s) occurred during ${phase}:\n${messages}`);

    this.name = "LifecycleError";
  }
}

/**
 * Error thrown when a provider configuration is invalid.
 */
export class InvalidProviderError extends InjectionError {
  /**
   * @param {unknown} provider - The invalid provider value
   */
  public constructor(provider: unknown) {
    super(`Invalid provider configuration: ${JSON.stringify(provider)}`);

    this.name = "InvalidProviderError";
  }
}
