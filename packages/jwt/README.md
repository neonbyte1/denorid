<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  JWT utilities module based on the <a href="https://github.com/panva/jose">jose</a> package.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/drizzle">
    <img src="https://jsr.io/badges/@denorid/logger" alt="Denorid Logger version" />
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
    }),
  ],
})
export class AppModule {}
```

### Asymmetric keys (RS256 / ES256)

Use `forRootAsync` so key import runs inside the async factory:

```ts
function pemToBinary(pem: string): Uint8Array {
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
          "pkcs8", // PEM private key → PKCS#8
          pemToBinary(config.get("JWT_PRIVATE_KEY")),
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false, // not extractable
          ["sign"],
        );

        const publicKey = await crypto.subtle.importKey(
          "spki", // PEM public key → SubjectPublicKeyInfo
          pemToBinary(config.get("JWT_PUBLIC_KEY")),
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );

        // ES256 - swap algorithm: { name: "ECDSA", namedCurve: "P-256" }

        return { privateKey, publicKey, signOptions: { exp: "1h" } };
      },
    }),
  ],
})
export class AppModule {}
```

### Async configuration (symmetric secret)

```ts
@Module({
  imports: [
    JwtModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        secret: config.get("JWT_SECRET"),
        signOptions: { exp: config.get("JWT_TTL") },
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
  constructor(private readonly jwt: JwtService) {}

  async login(userId: string): Promise<string> {
    // Sign - uses module defaults; override per-call via options
    return this.jwt.sign({ sub: userId });
  }

  async validate(token: string): Promise<JWTPayload> {
    // Verify - throws if invalid or expired
    const { payload } = await this.jwt.verify(token);

    return payload;
  }

  async inspect(token: string): Promise<JWTPayload> {
    // Decode without verifying signature - only for already-trusted input
    return this.jwt.decode(token);
  }
}
```

Per-call key material overrides the module default:

```ts
// Override secret for a single sign
const token = await this.jwt.sign({ sub: "123" }, {
  secret: "other-secret",
  exp: "15m",
});

// Override public key for a single verify
const { payload } = await this.jwt.verify(token, { publicKey: externalKey });
```

## License

The [@denorid/jwt](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
