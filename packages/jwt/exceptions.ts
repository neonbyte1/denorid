import type { KeyScope } from "./common.ts";

/**
 * Thrown when the supplied secret or key does not match the expected {@link KeyScope}
 * for a sign or verify operation.
 */
export class WrongKeyError extends Error {
  /**
   * @param {KeyScope} scope - The key scope (`"publicKey"` or `"privateKey"`) that was invalid.
   */
  public constructor(scope: KeyScope) {
    super(`Wrong secret or ${scope}`);
  }
}
