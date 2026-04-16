import type {
  CryptoKey,
  JWK,
  JWTHeaderParameters,
  JWTVerifyOptions,
  KeyObject,
} from "@panva/jose";

/** Supported cryptographic key representations for signing and verification. */
export type KeyType = CryptoKey | KeyObject | JWK | Uint8Array<ArrayBuffer>;

/** Accepted secret formats — either a raw string or a structured {@link KeyType}. */
export type SecretType = string | KeyType;

/** Discriminates between the public and private halves of an asymmetric key pair. */
export type KeyScope = "publicKey" | "privateKey";

/**
 * Options controlling JWT payload claims and signing behaviour for a single sign operation.
 *
 * All standard JWT registered claims are optional; omitted claims are not included in the token.
 * `secret` and `privateKey` are mutually exclusive — use `secret` for HMAC algorithms and
 * `privateKey` for asymmetric algorithms.
 */
export interface JwtSignOptions {
  /** Issuer claim (`iss`). Identifies the principal that issued the JWT. */
  iss?: string;
  /** Subject claim (`sub`). Identifies the principal that is the subject of the JWT. */
  sub?: string;
  /** Audience claim (`aud`). Identifies the recipients the JWT is intended for. */
  aud?: string | string[];
  /** JWT ID claim (`jti`). Provides a unique identifier for the token. */
  jti?: string;
  /** Not-before claim (`nbf`). Token is not valid before this time. */
  nbf?: number | string | Date;
  /** Expiration time claim (`exp`). Token must not be accepted on or after this time. */
  exp?: number | string | Date;
  /** Issued-at claim (`iat`). Identifies the time at which the token was issued. */
  iat?: number | string | Date;
  /** Additional JOSE protected header parameters merged into the token header. */
  protectedHeader?: Partial<JWTHeaderParameters>;
  /** Symmetric secret used with HMAC algorithms (e.g. HS256). Mutually exclusive with `privateKey`. */
  secret?: SecretType;
  /** Asymmetric private key used with algorithms such as RS256 or ES256. Mutually exclusive with `secret`. */
  privateKey?: KeyType;
}

/**
 * Options controlling JWT verification for a single verify operation.
 *
 * Extends `@panva/jose` {@link JWTVerifyOptions} with convenience fields for supplying the
 * verification key. `secret` and `publicKey` are mutually exclusive.
 */
export interface JwtVerifyOptions extends JWTVerifyOptions {
  /** Symmetric secret used to verify HMAC-signed tokens. Mutually exclusive with `publicKey`. */
  secret?: SecretType;
  /** Asymmetric public key used to verify tokens signed with RS256, ES256, etc. Mutually exclusive with `secret`. */
  publicKey?: KeyType;
}

/**
 * Module-level configuration for the JWT package.
 *
 * Keys and options supplied here become the module-wide defaults and may be overridden
 * per-operation via {@link JwtSignOptions} / {@link JwtVerifyOptions}.
 */
export interface JwtModuleOptions {
  /** When `true`, registers the JWT module as a global provider. */
  global?: boolean;
  /** Default sign options applied to every sign operation (excluding key material). */
  signOptions?: Omit<JwtSignOptions, "secret" | "privateKey">;
  /** Default symmetric secret used for both signing and verification. */
  secret?: SecretType;
  /** Default asymmetric public key used for token verification. */
  publicKey?: KeyType;
  /** Default asymmetric private key used for token signing. */
  privateKey?: KeyType;
  /** Default verification options applied to every verify operation. */
  verifyOptions?: JwtVerifyOptions;
}
