/**
 * @module
 *
 * JWT package for Denorid - provides JSON Web Token signing, verification, and decoding
 * together with JWK key-pair lifecycle management, wired up via the Denorid injector.
 *
 * ### Quick start
 *
 * ```ts
 * // Synchronous registration
 * JwtModule.forRoot({ secret: "my-secret", signOptions: { exp: "1h" } });
 *
 * // Async registration (e.g. from a config service)
 * JwtModule.forRootAsync({
 *   imports: [ConfigModule],
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({ secret: config.get("JWT_SECRET") }),
 * });
 * ```
 *
 * ### Exports
 *
 * | Symbol | Description |
 * |---|---|
 * | {@link JwtModule} | Denorid module - register with `forRoot` or `forRootAsync` |
 * | {@link JwtService} | Sign, verify, and decode JWTs |
 * | {@link JwkService} | Generate and load RS256 JWK key pairs |
 * | {@link JwtModuleOptions} | Module-level configuration interface |
 * | {@link JwtModuleAsyncOptions} | Async variant of module configuration |
 * | {@link JwtSignOptions} | Per-operation sign options |
 * | {@link JwtVerifyOptions} | Per-operation verify options |
 * | {@link WrongKeyError} | Thrown when key scope is invalid |
 * | {@link KeyType} | Union of accepted cryptographic key representations |
 * | {@link SecretType} | Union of accepted secret formats |
 * | {@link KeyScope} | Discriminator for public vs. private key halves |
 * | {@link JwkMetadata} | Full JWK key-pair metadata |
 * | {@link PublicJwkMetadata} | Safe public JWK representation for JWKS endpoints |
 */
export * from "./common.ts";
export * from "./exceptions.ts";
export * from "./jwk_service.ts";
export * from "./jwt_module.ts";
export * from "./jwt_service.ts";
