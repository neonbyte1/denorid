/**
 * Thrown when a KV connection with the given name is not registered.
 */
export class ConnectionNotFoundException extends Error {
  /**
   * @param {string} name - The name of the connection that was not found.
   */
  public constructor(name: string) {
    super(`Failed to find "${name}" connection.`);
  }
}

/**
 * Thrown when a registered KV connection has not been opened yet.
 */
export class ConnectionNotEstablishedException extends Error {
  /**
   * @param {string} name - The name of the connection that is not established.
   */
  public constructor(name: string) {
    super(`The connection to "${name}" kv is not established yet.`);
  }
}
