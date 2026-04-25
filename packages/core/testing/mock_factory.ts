import type { InjectionToken } from "@denorid/injector";

/**
 * A factory function used to create mock instances for unresolved injection tokens.
 *
 * @param {InjectionToken} token - The injection token that could not be resolved.
 * @returns {unknown} A mock value to use in place of the real provider.
 */
export type MockFactory = (token: InjectionToken) => unknown;
