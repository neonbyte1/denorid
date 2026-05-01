import { Inject, Injectable } from "@denorid/injector";
import {
  decodeJwt,
  type JWTPayload,
  jwtVerify,
  type JWTVerifyResult,
  SignJWT,
} from "@panva/jose";
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
 * Asymmetric algorithms (RS256, ES256, ...) are selected automatically when a `privateKey` /
 * `publicKey` is present; otherwise HMAC (HS256) is used.
 */
@Injectable()
export class JwtService {
  @Inject(JWT_MODULE_OPTIONS, { optional: true })
  private readonly options?: JwtModuleOptions;

  /**
   * Sign a JWT payload and return the compact serialised token string.
   *
   * The algorithm is chosen automatically: RS256 when a `privateKey` is supplied (either in
   * `options` or the module defaults), HS256 otherwise.
   * Module-level {@link JwtModuleOptions.signOptions} are merged with `options`; per-operation
   * values take precedence.
   *
   * @param {T} payload - JWT payload claims to embed in the token.
   * @param {JwtSignOptions} [options] - Per-operation sign options. Overrides module defaults.
   * @return {Promise<string>} Compact JWS string representing the signed token.
   * @throws {WrongKeyError} When no secret or private key can be resolved.
   */
  public sign<T extends JWTPayload>(
    payload: T,
    options?: JwtSignOptions,
  ): Promise<string> {
    const secret = this.getSecretKey(options, "privateKey");
    const opts = this.getSignOptions(options);
    const jwt = new SignJWT(payload)
      .setProtectedHeader({
        alg: options?.privateKey || this.options?.privateKey
          ? "RS256"
          : "HS256",
        ...(opts.protectedHeader ?? {}),
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

    return jwt.sign(secret);
  }

  /**
   * Verify a JWT and return its decoded header and payload.
   *
   * Delegates to `@panva/jose` `jwtVerify`. The verification key is resolved from `options`
   * first, then module defaults; a `publicKey` is used for asymmetric tokens, `secret` for HMAC.
   *
   * @param {string | Uint8Array} jwt - Compact JWS string or its UTF-8 byte representation.
   * @param {JwtVerifyOptions} [options] - Per-operation verify options. Overrides module defaults.
   * @return {Promise<JWTVerifyResult<T>>} Decoded and verified JWT payload together with the protected header.
   * @throws {WrongKeyError} When no secret or public key can be resolved.
   */
  public verify<T>(
    jwt: string | Uint8Array,
    options?: JwtVerifyOptions,
  ): Promise<JWTVerifyResult<T>> {
    const secret = this.getSecretKey(options, "publicKey");

    return jwtVerify(jwt, secret, options);
  }

  /**
   * Decode a JWT payload **without** verifying its signature.
   *
   * Use this only when signature verification is handled elsewhere or the token origin is already
   * trusted. For untrusted input, prefer {@link verify}.
   *
   * @param {string | Uint8Array} jwt - Compact JWS string or its UTF-8 byte representation.
   * @return {Promise<T & JWTPayload>} Decoded payload merged with standard JWT registered claims.
   */
  public decode<T>(
    jwt: string | Uint8Array,
  ): Promise<T & JWTPayload> {
    return decodeJwt(
      jwt instanceof Uint8Array ? new TextDecoder().decode(jwt) : jwt,
    );
  }

  /**
   * Merge module-level sign defaults with per-operation `options`, stripping key material.
   *
   * Key fields (`secret`, `privateKey`) are removed from the result so they are never
   * accidentally passed to `@panva/jose` as claim values.
   *
   * @param {JwtSignOptions | undefined} options - Per-operation sign options.
   * @return {JwtSignOptions} Merged options with key material removed.
   */
  protected getSignOptions(
    options: JwtSignOptions | undefined,
  ): JwtSignOptions {
    const signOptions = {
      ...(this.options?.signOptions ?? {}),
      ...(options ?? {}),
    };

    delete signOptions.privateKey;
    delete signOptions.secret;

    return signOptions;
  }

  /**
   * Resolve the cryptographic key for the given `scope` from per-operation options or module defaults.
   *
   * Resolution order: `options.secret` → module `secret` → scope-specific key (`publicKey` /
   * `privateKey`) from `options` → scope-specific key from module defaults.
   * String secrets are UTF-8 encoded to `Uint8Array` before being returned.
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
    const secretKey = (options?.secret ?? this.options?.secret) ??
      (scope === "publicKey"
        ? ((options as JwtVerifyOptions)?.publicKey ?? this.options?.publicKey)
        : ((options as JwtSignOptions)?.privateKey ??
          this.options?.privateKey));

    if (secretKey === undefined) {
      throw new WrongKeyError(scope);
    }

    return typeof secretKey === "string"
      ? new TextEncoder().encode(secretKey)
      : secretKey;
  }
}
