import type { JWK, KeyObject } from "@panva/jose";
import type { KeyType } from "./common.ts";

/** Parts of a WebCrypto `CryptoKey.algorithm` that determine the JWS algorithm. */
interface CryptoKeyAlgorithm {
  /** WebCrypto algorithm name, e.g. `"HMAC"`, `"RSA-PSS"` or `"ECDSA"`. */
  name: string;
  /** Hash bound to HMAC and RSA keys. */
  hash?: { name: string };
  /** Curve of ECDSA keys. */
  namedCurve?: string;
}

/** Parts of a `node:crypto` `KeyObject` that determine the JWS algorithm. */
interface NodeKeyObject extends KeyObject {
  /** Asymmetric key type, e.g. `"rsa"`, `"ec"` or `"ed25519"`. */
  asymmetricKeyType?: string;
  /** Details of asymmetric keys, including the OpenSSL name of an EC curve. */
  asymmetricKeyDetails?: { namedCurve?: string };
}

/**
 * Type guard for `node:crypto` `KeyObject` instances, detected by their `Symbol.toStringTag` like
 * `@panva/jose` does.
 *
 * @param {KeyObject | JWK} key - Key to inspect.
 * @return {boolean} `true` when `key` is a `KeyObject`.
 */
function isKeyObject(key: KeyObject | JWK): key is KeyObject {
  return Object.prototype.toString.call(key) === "[object KeyObject]";
}

/**
 * Appends the digest size of a SHA-2 hash to a JWS algorithm family prefix.
 *
 * @param {string} prefix - JWS algorithm family, e.g. `"HS"`, `"RS"` or `"PS"`.
 * @param {{ name: string } | undefined} hash - WebCrypto hash bound to the key.
 * @return {string | undefined} JWS algorithm, or `undefined` when JWS has none for the hash.
 */
function hashedAlgorithm(
  prefix: string,
  hash: { name: string } | undefined,
): string | undefined {
  switch (hash?.name) {
    case "SHA-256":
      return `${prefix}256`;
    case "SHA-384":
      return `${prefix}384`;
    case "SHA-512":
      return `${prefix}512`;
  }

  return undefined;
}

/**
 * Maps an elliptic curve to its ECDSA JWS algorithm.
 *
 * @param {string | undefined} curve - Curve name, either JOSE / WebCrypto (`"P-256"`) or OpenSSL (`"prime256v1"`).
 * @return {string | undefined} JWS algorithm, or `undefined` when JWS has none for the curve.
 */
function ecdsaAlgorithm(curve: string | undefined): string | undefined {
  switch (curve) {
    case "P-256":
    case "prime256v1":
      return "ES256";
    case "P-384":
    case "secp384r1":
      return "ES384";
    case "P-521":
    case "secp521r1":
      return "ES512";
  }

  return undefined;
}

/**
 * Maps a WebCrypto key algorithm to its JWS algorithm.
 *
 * @param {CryptoKeyAlgorithm} algorithm - The `algorithm` of a `CryptoKey`.
 * @return {string | undefined} JWS algorithm, or `undefined` when JWS has none for the key.
 */
function fromCryptoKey(
  { name, hash, namedCurve }: CryptoKeyAlgorithm,
): string | undefined {
  switch (name) {
    case "HMAC":
      return hashedAlgorithm("HS", hash);
    case "RSASSA-PKCS1-v1_5":
      return hashedAlgorithm("RS", hash);
    case "RSA-PSS":
      return hashedAlgorithm("PS", hash);
    case "ECDSA":
      return ecdsaAlgorithm(namedCurve);
    case "Ed25519":
      return "EdDSA";
  }

  return undefined;
}

/**
 * Maps a `node:crypto` `KeyObject` to its JWS algorithm.
 *
 * @param {NodeKeyObject} key - The key object.
 * @return {string | undefined} JWS algorithm, or `undefined` when JWS has none for the key.
 */
function fromKeyObject(
  { type, asymmetricKeyType, asymmetricKeyDetails }: NodeKeyObject,
): string | undefined {
  if (type === "secret") {
    return "HS256";
  }

  switch (asymmetricKeyType) {
    case "rsa":
      return "RS256";
    case "ec":
      return ecdsaAlgorithm(asymmetricKeyDetails?.namedCurve);
    case "ed25519":
      return "EdDSA";
  }

  return undefined;
}

/**
 * Maps a JSON Web Key to its JWS algorithm, preferring the key's own `alg` member.
 *
 * @param {JWK} jwk - The JSON Web Key.
 * @return {string | undefined} JWS algorithm, or `undefined` when JWS has none for the key.
 */
function fromJwk({ alg, kty, crv }: JWK): string | undefined {
  if (alg !== undefined) {
    return alg;
  }

  switch (kty) {
    case "oct":
      return "HS256";
    case "RSA":
      return "RS256";
    case "EC":
      return ecdsaAlgorithm(crv);
    case "OKP":
      return crv === "Ed25519" ? "EdDSA" : undefined;
  }

  return undefined;
}

/**
 * Infers the JWS signing algorithm (`alg` header) from the key that signs the token.
 *
 * Raw secrets and secret `KeyObject`s use HS256. A `CryptoKey` maps its WebCrypto algorithm:
 * HMAC to `HS*`, RSASSA-PKCS1-v1_5 to `RS*` and RSA-PSS to `PS*` (by the bound hash), ECDSA to
 * `ES256` / `ES384` / `ES512` (by curve) and Ed25519 to `EdDSA`. RSA `KeyObject`s and JWKs without
 * an `alg` member use RS256, `oct` JWKs use HS256, EC and Ed25519 ones map like their `CryptoKey`
 * counterparts. A JWK with an `alg` member uses that value.
 *
 * @param {KeyType} key - The signing key.
 * @return {string} The inferred JWS algorithm.
 * @throws {TypeError} When no JWS algorithm can be inferred from `key`.
 */
export function inferAlgorithm(key: KeyType): string {
  let alg: string | undefined;

  if (key instanceof Uint8Array) {
    alg = "HS256";
  } else if (key instanceof CryptoKey) {
    alg = fromCryptoKey(key.algorithm);
  } else if (isKeyObject(key)) {
    alg = fromKeyObject(key);
  } else {
    alg = fromJwk(key);
  }

  if (alg === undefined) {
    throw new TypeError(
      "Cannot infer the JWS algorithm from the signing key, set protectedHeader.alg explicitly",
    );
  }

  return alg;
}
