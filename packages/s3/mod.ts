/**
 * @module
 *
 * S3 package for Denorid - wires the `@aws-sdk/client-s3` aggregated S3
 * client into the Denorid dependency injector with first-class support
 * for multiple named connections.
 *
 * Every injected {@link StorageClient} extends the SDK's `S3` class verbatim,
 * so every command - object operations (`putObject`, `getObject`,
 * `deleteObjects`, ...), bucket management (`createBucket`, `listBuckets`,
 * `putBucketCors`, ...), multipart uploads (`createMultipartUpload`,
 * `uploadPart`, `completeMultipartUpload`, ...), the `waitUntil*` helpers,
 * the `paginate*` helpers, and any commands added in future SDK releases -
 * is available as a method with the SDK's own input/output types.
 *
 * ### Quick start
 *
 * ```ts
 * // Single default connection
 * S3Module.forRoot({
 *   connection: {
 *     region: "eu-central-1",
 *     credentials: { accessKeyId: "...", secretAccessKey: "..." },
 *   },
 * });
 *
 * // Multiple named connections (multi-region, multi-tenant, S3 + R2 + MinIO, ...)
 * S3Module.forRoot({
 *   connections: [
 *     { name: "primary", region: "us-east-1", credentials: prodCreds },
 *     { name: "backup",  region: "eu-central-1", credentials: prodCreds },
 *     {
 *       name: "minio",
 *       region: "us-east-1",
 *       endpoint: "http://127.0.0.1:9000",
 *       credentials: { accessKeyId: "minio", secretAccessKey: "minio123" },
 *       forcePathStyle: true,
 *     },
 *   ],
 * });
 * ```
 *
 * ### Exports
 *
 * | Symbol | Description |
 * |---|---|
 * | {@link S3Module} | Denorid module - register with `forRoot` or `forRootAsync` |
 * | {@link StorageClient} | Aggregated S3 client; one method per AWS command |
 * | {@link StorageConnections} | Registry of every registered storage client |
 * | {@link InjectStorage} | Field decorator: `InjectStorage(name?)` |
 * | {@link S3ConnectionInfo} | Single named connection descriptor |
 * | {@link S3ConnectionOptions} | Single-connection module configuration |
 * | {@link S3ConnectionsOptions} | Multi-connection module configuration |
 * | {@link S3ModuleOptions} | Union of the two sync configuration shapes |
 * | {@link S3AsyncModuleOptions} | Async variant of module configuration |
 * | {@link S3ClientConfig} | Re-export of the SDK config type |
 * | {@link S3ConnectionNotFoundError} | Thrown by `StorageConnections.get` |
 * | {@link DuplicateS3ConnectionNameError} | Thrown when two connections share a name |
 */
export * from "./connections.ts";
export * from "./exceptions.ts";
export * from "./module.ts";
export * from "./module_options.ts";
export * from "./storage_client.ts";
