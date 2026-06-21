/**
 * Thrown when {@link StorageConnections.get} is asked for a connection
 * name that was never registered through {@link S3Module.forRoot} /
 * {@link S3Module.forRootAsync}.
 */
export class S3ConnectionNotFoundError extends Error {
  /** The connection name that could not be resolved. */
  public readonly connectionName: string;

  public constructor(connectionName: string) {
    super(`No S3 connection is registered under name "${connectionName}".`);

    this.name = S3ConnectionNotFoundError.name;
    this.connectionName = connectionName;
  }
}

/**
 * Thrown during module compilation when two connection descriptors share
 * the same `name`. Names must be unique across a single `S3Module`
 * registration.
 */
export class DuplicateS3ConnectionNameError extends Error {
  /** The duplicated connection name. */
  public readonly connectionName: string;

  public constructor(connectionName: string) {
    super(
      `Duplicate S3 connection name "${connectionName}"; ` +
        `each registered connection must have a unique name.`,
    );

    this.name = DuplicateS3ConnectionNameError.name;
    this.connectionName = connectionName;
  }
}
