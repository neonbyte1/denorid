import { Inject, Injectable } from "@denorid/injector";
import {
  decodeJwt,
  type JWTPayload,
  jwtVerify,
  type JWTVerifyResult,
  SignJWT,
} from "@panva/jose";
import { inferAlgorithm } from "./_algorithm.ts";
import { JWT_MODULE_OPTIONS } from "./_constants.ts";
import type {
  JwtModuleOptions,
  JwtSignOptions,
  JwtVerifyOptions,
  KeyScope,
  KeyType,
} from "./common.ts";
import { WrongKeyError } from "./exceptions.ts";

/**
 * Injectable service for signing, verifying, and decoding JSON Web Tokens.
 *
 * Key material and default sign/verify options are resolved from module-level
 * {@link JwtModuleOptions} and may be overridden per-operation via the `options` argument.
 * The signing algorithm is inferred from the signing key (HS256 for secrets; RS*, PS*, ES* or
 * EdDSA for asymmetric keys) unless `protectedHeader.alg` is set.
 */
@Injectable()
export class JwtService {
  @Inject(JWT_MODULE_OPTIONS, { optional: true })
  private readonly options?: JwtModuleOptions;

  /**
   * Sign a JWT payload and return the compact serialised token string.
   *
   * The key is the per-operation `secret` / `privateKey`, else the module `secret` / `privateKey`.
   * The `alg` header is the per-operation `protectedHeader.alg`, else the module
   * `signOptions.protectedHeader.alg` when the module key signs, else the algorithm inferred from
   * the key: HS256 for secrets, `RS*` / `PS*` / `ES*` / `EdDSA` for `CryptoKey`s by their
   * WebCrypto algorithm, a JWK's own `alg` member, or the default algorithm of its key type.
   * Module-level {@link JwtModuleOptions.signOptions} are merged with `options`; per-operation
   * values take precedence, `protectedHeader` is merged parameter by parameter.
   *
   * @param {T} payload - JWT payload claims to embed in the token.
   * @param {JwtSignOptions} [options] - Per-operation sign options. Overrides module defaults.
   * @return {Promise<string>} Compact JWS string representing the signed token.
   * @throws {WrongKeyError} When no secret or private key can be resolved (as a rejection).
   * @throws {TypeError} When no algorithm can be inferred from the key and none is set (as a rejection).
   */
  public async sign<T extends JWTPayload>(
    payload: T,
    options?: JwtSignOptions,
  ): Promise<string> {
    const key = this.getSecretKey(options, "privateKey");
    const { protectedHeader, ...opts } = this.getSignOptions(options);
    const alg = options?.secret === undefined &&
        options?.privateKey === undefined
      ? protectedHeader?.alg
      : options.protectedHeader?.alg;
    const jwt = new SignJWT(payload)
      .setProtectedHeader({
        ...protectedHeader,
        alg: alg ?? inferAlgorithm(key),
      })
      .setIssuedAt(opts.iat);

    if (opts.iss) {
      jwt.setIssuer(opts.iss);
    }
    if (opts.sub) {
      jwt.setSubject(opts.sub);
    }
    if (opts.aud) {
      jwt.setAudience(opts.aud);
    }
    if (opts.jti) {
      jwt.setJti(opts.jti);
    }
    if (opts.nbf) {
      jwt.setNotBefore(opts.nbf);
    }
    if (opts.exp) {
      jwt.setExpirationTime(opts.exp);
    }

    return await jwt.sign(key);
  }

  /**
   * Verify a JWT and return its decoded header and payload.
   *
   * Delegates to `@panva/jose` `jwtVerify`. The verification key is the per-operation `secret` /
   * `publicKey`, else the module `secret` / `publicKey`. Module-level
   * {@link JwtModuleOptions.verifyOptions} (issuer, audience, algorithms, ...) always apply;
   * per-operation options replace individual fields.
   *
   * @param {string | Uint8Array} jwt - Compact JWS string or its UTF-8 byte representation.
   * @param {JwtVerifyOptions} [options] - Per-operation verify options. Overrides module defaults.
   * @return {Promise<JWTVerifyResult<T>>} Decoded and verified JWT payload together with the protected header.
   * @throws {WrongKeyError} When no secret or public key can be resolved (as a rejection).
   */
  public async verify<T>(
    jwt: string | Uint8Array,
    options?: JwtVerifyOptions,
  ): Promise<JWTVerifyResult<T>> {
    const key = this.getSecretKey(options, "publicKey");

    return await jwtVerify<T>(jwt, key, {
      ...this.options?.verifyOptions,
      ...options,
    });
  }

  /**
   * Decode a JWT payload **without** verifying its signature.
   *
   * Use this only when signature verification is handled elsewhere or the token origin is already
   * trusted. For untrusted input, prefer {@link verify}.
   *
   * @param {string | Uint8Array} jwt - Compact JWS string or its UTF-8 byte representation.
   * @return {Promise<T & JWTPayload>} Decoded payload merged with standard JWT registered claims.
   * @throws {JWTInvalid} When `jwt` is not a well-formed JWT (as a rejection).
   */
  // deno-lint-ignore require-await
  public async decode<T>(
    jwt: string | Uint8Array,
  ): Promise<T & JWTPayload> {
    // `async` turns the synchronous `decodeJwt` errors into rejections.
    return decodeJwt<T>(
      jwt instanceof Uint8Array ? new TextDecoder().decode(jwt) : jwt,
    );
  }

  /**
   * Merge module-level sign defaults with per-operation `options`, stripping key material.
   *
   * Per-operation values win; `protectedHeader` is merged parameter by parameter. Key fields
   * (`secret`, `privateKey`) are removed from the result so they are never accidentally passed to
   * `@panva/jose` as claim values.
   *
   * @param {JwtSignOptions | undefined} options - Per-operation sign options.
   * @return {JwtSignOptions} Merged options with key material removed.
   */
  protected getSignOptions(
    options: JwtSignOptions | undefined,
  ): JwtSignOptions {
    const signOptions = {
      ...this.options?.signOptions,
      ...options,
      protectedHeader: {
        ...this.options?.signOptions?.protectedHeader,
        ...options?.protectedHeader,
      },
    };

    delete signOptions.privateKey;
    delete signOptions.secret;

    return signOptions;
  }

  /**
   * Resolve the cryptographic key for the given `scope` from per-operation options or module defaults.
   *
   * Resolution order: `options.secret` -> scope-specific key (`publicKey` / `privateKey`) from
   * `options` -> module `secret` -> scope-specific key from module defaults, so any per-operation
   * key overrides every module key. String secrets are UTF-8 encoded to `Uint8Array` before being
   * returned.
   *
   * @param {JwtSignOptions | JwtVerifyOptions | undefined} options - Per-operation options carrying optional key material.
   * @param {KeyScope} scope - Whether to resolve a `"publicKey"` or `"privateKey"`.
   * @return {KeyType} Resolved cryptographic key ready for use with `@panva/jose`.
   * @throws {WrongKeyError} When no key can be resolved for the requested `scope`.
   */
  protected getSecretKey(
    options: JwtSignOptions | JwtVerifyOptions | undefined,
    scope: KeyScope,
  ): KeyType {
    // Each options type declares only the key of its own scope; reading the other one yields
    // `undefined`, which falls through to the module defaults.
    const scoped = options as Partial<Record<KeyScope, KeyType>> | undefined;
    const secretKey = options?.secret ?? scoped?.[scope] ??
      this.options?.secret ?? this.options?.[scope];

    if (secretKey === undefined) {
      throw new WrongKeyError(scope);
    }

    return typeof secretKey === "string"
      ? new TextEncoder().encode(secretKey)
      : secretKey;
  }
}
