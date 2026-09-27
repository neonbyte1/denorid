/**
 * Thrown by `ConfigService.getOrThrow` when the requested key is not set.
 */
export class ConfigKeyNotFoundError extends Error {
  /**
   * @param {string} path - Dot separated path of the missing key.
   */
  public constructor(public readonly path: string) {
    super(`Configuration key "${path}" does not exist`);
    this.name = "ConfigKeyNotFoundError";
  }
}
