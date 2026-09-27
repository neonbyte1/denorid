import type { InjectionToken } from "./common.ts";
import type { Container } from "./container.ts";

/**
 * Finds the container declaring `token` as own provider: `root` itself or
 * the nearest container among its (transitive) imports, breadth-first.
 *
 * @param {Container} root - The container to start from
 * @param {InjectionToken} token - The provider token
 * @returns {Container|undefined} The declaring container, or `undefined`
 *          when no container of the graph declares the token.
 *
 * @internal
 */
export function findDeclaringContainer(
  root: Container,
  token: InjectionToken,
): Container | undefined {
  const visited = new Set<Container>([root]);
  const queue: Container[] = [root];

  for (const container of queue) {
    if (container.has(token)) {
      return container;
    }

    for (const child of container.getChildren()) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }

  return undefined;
}

/**
 * Resolves `token` from anywhere in the module graph of `root` (NestJS
 * `strict: false` semantics): through `root` when the token is visible there
 * (own, exported by an import or global), otherwise from the module that
 * declares it.
 *
 * @template T - The resolved type
 * @param {Container} root - The root container of the graph
 * @param {InjectionToken<T>} token - The provider token
 * @param {string|undefined} contextId - Optional context identifier for
 *        per-context transient caching
 * @returns {Promise<T>} Resolves into the instance when fulfilled.
 * @throws {TokenNotFoundError} When no container of the graph provides the token.
 *
 * @internal
 */
export function resolveFromGraph<T>(
  root: Container,
  token: InjectionToken<T>,
  contextId?: string,
): Promise<T> {
  const container = root.canResolve(token)
    ? root
    : findDeclaringContainer(root, token) ?? root;

  return contextId === undefined
    ? container.resolve(token)
    : container.resolveWithContext(token, contextId);
}
