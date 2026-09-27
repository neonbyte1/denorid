import {
  getInjectableMetadata,
  getInjectionDependencies,
} from "./_internal.ts";
import type { InjectableMode, InjectionToken } from "./common.ts";
import type { Container } from "./container.ts";
import { InvalidProviderError } from "./errors.ts";
import {
  isClassProvider,
  isExistingProvider,
  isFactoryProvider,
  isValueProvider,
  type Provider,
} from "./provider.ts";

/**
 * A normalized provider that produces its value itself (class, factory and
 * value providers).
 *
 * @internal
 */
export interface NormalizedFactoryProvider {
  /**
   * The token that identifies this provider in the container.
   */
  token: InjectionToken;

  /**
   * The declared injectable mode (e.g., "singleton" or "transient"). The
   * container resolves a provider as `"request"` when one of its
   * `dependencies` is request-scoped (scope bubbling).
   */
  mode: InjectableMode;

  /**
   * The tokens the provider resolves while it is created: the `@Inject`
   * fields of a class (inherited ones included) or the `inject` list of a
   * factory.
   */
  dependencies: readonly InjectionToken[];

  /**
   * Whether the container creates the value and therefore owns it: `true` for
   * class and factory providers, `false` for values. Owned values are
   * disposed when the container shuts down.
   */
  owned: boolean;

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
 * A normalized alias (`useExisting`). An alias resolves its target on every
 * call, reports the target's mode and is neither cached nor tracked for
 * lifecycle hooks or disposal.
 *
 * @internal
 */
export interface NormalizedAliasProvider {
  /**
   * The token that identifies this provider in the container.
   */
  token: InjectionToken;

  /**
   * The aliased (target) token.
   */
  existing: InjectionToken;
}

/**
 * Represents a provider normalized for registration in the container.
 *
 * @internal
 */
export type NormalizedProvider =
  | NormalizedFactoryProvider
  | NormalizedAliasProvider;

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
      owned: true,
      dependencies: getInjectionDependencies(provider).map(({ token }) =>
        token
      ),
      resolve: (container) => container.instantiateClass(provider),
    };
  }

  if (isValueProvider(provider)) {
    return {
      token: provider.provide,
      mode: "singleton",
      owned: false,
      dependencies: [],
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

    const dependencies = provider.inject ?? [];

    return {
      token: provider.provide,
      mode,
      owned: true,
      dependencies,
      resolve: async (container) => {
        // Sequential on purpose: dependencies are created (and therefore
        // bootstrapped and torn down) in a deterministic order.
        const deps: unknown[] = [];

        for (const token of dependencies) {
          deps.push(await container.resolve(token));
        }

        return provider.useFactory(...deps);
      },
    };
  }

  if (isClassProvider(provider)) {
    const metadata = getInjectableMetadata(provider.useClass);

    return {
      token: provider.provide,
      mode: metadata?.mode ?? "singleton",
      owned: true,
      dependencies: getInjectionDependencies(provider.useClass).map((
        { token },
      ) => token),
      resolve: (container) => container.instantiateClass(provider.useClass),
    };
  }

  if (isExistingProvider(provider)) {
    return {
      token: provider.provide,
      existing: provider.useExisting,
    };
  }

  throw new InvalidProviderError(provider);
}
