<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  JWT utilities module based on the <a href="https://github.com/panva/jose">jose</a> package.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/jwt">
    <img src="https://jsr.io/badges/@denorid/jwt" alt="Denorid jwt version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/jwt
```

## Quick Start

### Symmetric secret (HS256)

```ts
@Module({
  imports: [
    JwtModule.forRoot({
      secret: "my-super-secret",
      signOptions: { exp: "1h", iss: "my-app" },
      verifyOptions: { issuer: "my-app" },
    }),
  ],
})
export class AppModule {}
```

`verifyOptions` (for example `issuer`, `audience`, `algorithms`, `maxTokenAge`)
are enforced on every `verify` call. Per-call verify options replace individual
fields.

### Asymmetric keys (RS256 / ES256 / EdDSA)

Use `forRootAsync` so key import runs inside the async factory:

```ts
function pemToBinary(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

@Module({
  imports: [
    JwtModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const privateKey = await crypto.subtle.importKey(
          "pkcs8", // PEM private key -> PKCS#8
          pemToBinary(config.getOrThrow<string>("JWT_PRIVATE_KEY")),
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false, // not extractable
          ["sign"],
        );

        const publicKey = await crypto.subtle.importKey(
          "spki", // PEM public key -> SubjectPublicKeyInfo
          pemToBinary(config.getOrThrow<string>("JWT_PUBLIC_KEY")),
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );

        // ES256 - swap algorithm: { name: "ECDSA", namedCurve: "P-256" }
        // EdDSA - swap algorithm: { name: "Ed25519" }

        return { privateKey, publicKey, signOptions: { exp: "1h" } };
      },
    }),
  ],
})
export class AppModule {}
```

### Algorithm selection

The `alg` header is inferred from the key that signs the token:

| Signing key                            | `alg`                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `string` / `Uint8Array` secret         | `HS256`                                                                        |
| `CryptoKey` `HMAC`                     | `HS256` / `HS384` / `HS512` (by hash)                                          |
| `CryptoKey` `RSASSA-PKCS1-v1_5`        | `RS256` / `RS384` / `RS512` (by hash)                                          |
| `CryptoKey` `RSA-PSS`                  | `PS256` / `PS384` / `PS512` (by hash)                                          |
| `CryptoKey` `ECDSA`                    | `ES256` / `ES384` / `ES512` (by curve)                                         |
| `CryptoKey` `Ed25519`                  | `EdDSA`                                                                        |
| JWK with an `alg` member               | that `alg`                                                                     |
| JWK / `KeyObject` without an algorithm | by key type: `oct` / secret `HS256`, RSA `RS256`, EC by curve, Ed25519 `EdDSA` |

Set `protectedHeader.alg` to pick the algorithm explicitly. A module-level
`signOptions.protectedHeader.alg` only applies while the module key signs; a
per-call `secret` / `privateKey` uses its own inferred algorithm unless the call
sets `protectedHeader.alg` too. Module and per-call `protectedHeader` parameters
are merged, per-call values win.

### Async configuration (symmetric secret)

```ts
@Module({
  imports: [
    JwtModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_SECRET"),
        signOptions: { exp: config.get<string>("JWT_TTL") },
      }),
    }),
  ],
})
export class AppModule {}
```

### Using JwtService

```ts
@Injectable()
export class AuthService {
  @Inject(JwtService)
  private readonly jwt!: JwtService;

  public login(userId: string): Promise<string> {
    // Sign - uses module defaults; override per-call via options
    return this.jwt.sign({ sub: userId });
  }

  public async validate(token: string): Promise<JWTPayload> {
    // Verify - rejects if invalid, expired or not matching verifyOptions
    const { payload } = await this.jwt.verify(token);

    return payload;
  }

  public inspect(token: string): Promise<JWTPayload> {
    // Decode without verifying signature - only for already-trusted input
    return this.jwt.decode(token);
  }
}
```

`sign`, `verify` and `decode` always return promises: every error, including
`WrongKeyError` when no key is configured, surfaces as a rejection.

Per-call key material overrides the module keys, whichever kind they are:

```ts
// Override secret for a single sign (HS256, even if the module has an RSA key pair)
const token = await this.jwt.sign({ sub: "123" }, {
  secret: "other-secret",
  exp: "15m",
});

// Override public key for a single verify
const { payload } = await this.jwt.verify(externalToken, {
  publicKey: externalKey,
});
```

## License

The [@denorid/jwt](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
