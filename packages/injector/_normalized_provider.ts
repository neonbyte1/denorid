import {
  getInjectableMetadata,
  isClassProvider,
  isExistingProvider,
  isFactoryProvider,
  isValueProvider,
} from "./_internal.ts";
import type { InjectableMode, InjectionToken } from "./common.ts";
import type { Container } from "./container.ts";
import { InvalidProviderError } from "./errors.ts";
import type { Provider } from "./provider.ts";

/**
 * Represents a provider normalized for registration in the container.
 *
 * @internal
 */
export interface NormalizedProvider {
  /**
   * The token that identifies this provider in the container.
   */
  token: InjectionToken;

  /**
   * The injectable mode (e.g., "singleton" or "transient").
   */
  mode: InjectableMode;

  /**
   * Function to resolve the provider's value from a container
   *
   * @param {Container} container - The container used to resolve dependencies
   * @returns {unknown|Promise<unknown>} The function returns the resolved instance or a
   *          `Promise` that resolves into the instance when fulfilled.
   */
  resolve: (container: Container) => unknown | Promise<unknown>;
}

/**
 * Normalizes a provider into a standard format for container registration.
 *
 * @param {Provider} provider - The provider to normalize
 * @returns {NormalizedProvider} A {@linkcode NormalizedProvider} object suitable
 *          for internal container use.
 * @throws {InvalidProviderError} If the provider is invalid
 *
 * @internal
 */
export function normalizeProvider(provider: Provider): NormalizedProvider {
  if (typeof provider === "function") {
    const metadata = getInjectableMetadata(provider);

    return {
      token: provider,
      mode: metadata?.mode ?? "singleton",
      resolve: (container) => container.instantiateClass(provider),
    };
  }

  if (isValueProvider(provider)) {
    return {
      token: provider.provide,
      mode: "singleton",
      resolve: () => provider.useValue,
    };
  }

  if (isFactoryProvider(provider)) {
    let mode: InjectableMode = "singleton";

    if (provider.mode) {
      mode = provider.mode;
    } else if (typeof provider.provide === "function") {
      mode = getInjectableMetadata(provider.provide)?.mode ?? "singleton";
    }

    return {
      token: provider.provide,
      mode,
      resolve: async (container) => {
        const deps = await Promise.all(
          (provider.inject ?? []).map((token) => container.resolve(token)),
        );
        return provider.useFactory(...deps);
      },
    };
  }

  if (isClassProvider(provider)) {
    const metadata = getInjectableMetadata(provider.useClass);

    return {
      token: provider.provide,
      mode: metadata?.mode ?? "singleton",
      resolve: (container) => container.instantiateClass(provider.useClass),
    };
  }

  if (isExistingProvider(provider)) {
    return {
      token: provider.provide,
      mode: "singleton",
      resolve: (container) => container.resolve(provider.useExisting),
    };
  }

  throw new InvalidProviderError(provider);
}
