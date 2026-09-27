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

/**
 * Thrown when a configuration file cannot be read or does not contain a
 * valid configuration.
 */
export class ConfigFileError extends Error {
  /**
   * @param {string} path - Path of the affected file.
   * @param {string} reason - Why the file was rejected.
   * @param {ErrorOptions} [options] - Standard error options (e.g. `cause`).
   */
  public constructor(
    public readonly path: string,
    reason: string,
    options?: ErrorOptions,
  ) {
    super(`Config file "${path}": ${reason}`, options);
    this.name = "ConfigFileError";
  }
}
