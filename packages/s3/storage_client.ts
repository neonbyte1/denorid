import { S3 } from "@aws-sdk/client-s3";

/**
 * Denorid-branded AWS S3 client.
 *
 * Extends the `@aws-sdk/client-s3` {@link S3} aggregated client unchanged -
 * inherits every command method (`putObject`, `getObject`, `listBuckets`,
 * `createMultipartUpload`, `uploadPart`, `selectObjectContent`, the
 * `waitUntil*` helpers, the `paginate*` helpers, ...) with the SDK's own
 * input/output types. New commands added in future SDK releases light up
 * automatically.
 *
 * Resolved through the {@link STORAGE_CLIENT} token or the {@link InjectStorage}
 * field decorator. The module calls `destroy()` on shutdown so the SDK's
 * keep-alive sockets close cleanly.
 *
 * @example
 * ```ts
 * @Injectable()
 * class AvatarService {
 *   @InjectStorage()
 *   private readonly storage!: StorageClient;
 *
 *   upload(key: string, body: Uint8Array): Promise<PutObjectCommandOutput> {
 *     return this.storage.putObject({ Bucket: "avatars", Key: key, Body: body });
 *   }
 * }
 * ```
 */
export class StorageClient extends S3 {}
