<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  S3 module for Denorid - wires the
  <a href="https://www.npmjs.com/package/@aws-sdk/client-s3">@aws-sdk/client-s3</a>
  aggregated S3 client into the Denorid dependency injector with first-class
  support for multiple named connections.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/s3">
    <img src="https://jsr.io/badges/@denorid/s3" alt="Denorid s3 version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/s3
```

## Quick Start

### Single default connection

```ts
@Module({
  imports: [
    S3Module.forRoot({
      connection: {
        region: "eu-central-1",
        credentials: {
          accessKeyId: "...",
          secretAccessKey: "...",
        },
      },
    }),
  ],
})
export class AppModule {}
```

### Multiple named connections

```ts
@Module({
  imports: [
    S3Module.forRoot({
      connections: [
        { name: "primary", region: "us-east-1", credentials: prodCreds },
        { name: "backup",  region: "eu-central-1", credentials: prodCreds },
        {
          name: "minio",
          region: "us-east-1",
          endpoint: "http://127.0.0.1:9000",
          credentials: { accessKeyId: "minio", secretAccessKey: "minio123" },
          forcePathStyle: true,
        },
      ],
    }),
  ],
})
export class AppModule {}
```

### Async configuration

```ts
@Module({
  imports: [
    S3Module.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connections: [
          { name: "primary", region: config.get("AWS_PRIMARY_REGION") },
          { name: "backup",  region: config.get("AWS_BACKUP_REGION") },
        ],
      }),
    }),
  ],
})
export class AppModule {}
```

## Using clients

```ts
import { InjectStorage, type StorageClient } from "@denorid/s3";

@Injectable()
export class AvatarService {
  @InjectStorage()                  // default connection
  private readonly main!: StorageClient;

  @InjectStorage("backup")          // named connection
  private readonly backup!: StorageClient;

  async replicate(key: string, body: Uint8Array): Promise<void> {
    await this.main.putObject({ Bucket: "avatars", Key: key, Body: body });
    await this.backup.putObject({ Bucket: "avatars", Key: key, Body: body });
  }
}
```

`StorageClient` extends the SDK's `S3` class unchanged, so every command -
object operations (`putObject`, `getObject`, `deleteObjects`, ...), bucket
management (`createBucket`, `listBuckets`, `putBucketCors`, ...), multipart
uploads (`createMultipartUpload`, `uploadPart`, `completeMultipartUpload`,
...), the `waitUntil*` helpers, the `paginate*` helpers, and any commands
added in future SDK releases - is available as a method with the SDK's own
input/output types. `destroy()` is invoked automatically on module
shutdown, so keep-alive sockets close cleanly.

### Programmatic access to the registry

```ts
import { Inject } from "@denorid/injector";
import { StorageConnections } from "@denorid/s3";

@Injectable()
export class BackupService {
  @Inject(StorageConnections)
  private readonly storage!: StorageConnections;

  fanOut(key: string, body: Uint8Array): Promise<unknown[]> {
    return Promise.all(
      [...this.storage.connections.keys()].map((name) =>
        this.storage.get(name).putObject({
          Bucket: "audit",
          Key: `${name}/${key}`,
          Body: body,
        })
      ),
    );
  }
}
```

## Caveats

- `S3Module.forRoot` registers exactly one module instance per application -
  declare every connection in a single call. The injector keys module
  containers by class type, so a second `S3Module.forRoot(...)` would
  silently drop its providers.
- Connection names are validated up front; duplicates raise
  `DuplicateS3ConnectionNameError` at module-resolution time.
- `S3Module.forRoot` is required even for a single connection - there is no
  ambient default.

## License

The [@denorid/s3](https://github.com/neonbyte1/denorid) package is [MIT licensed](../../LICENSE.md).
