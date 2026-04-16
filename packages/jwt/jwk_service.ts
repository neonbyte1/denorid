import { Injectable } from "@denorid/injector";
import { exportJWK, generateKeyPair, importJWK, type JWK } from "@panva/jose";

/** Full metadata for a JWK key pair, including both raw `CryptoKey` objects and their JWK representations. */
export interface JwkMetadata {
  /** Key ID (`kid`) uniquely identifying this key pair. */
  kid: string;
  /** Imported public key ready for use in cryptographic operations. */
  publicKey: CryptoKey | Uint8Array;
  /** Imported private key ready for use in cryptographic operations. */
  privateKey: CryptoKey | Uint8Array;
  /** Public key serialised as a JWK object. */
  publicJwk: JWK;
  /** Private key serialised as a JWK object. */
  privateJwk: JWK;
}

/**
 * Safe-to-expose public JWK representation with enforced `kid`, `use`, and `alg` fields.
 *
 * Intended for publishing via a JWKS endpoint — the private key fields are never included.
 */
export type PublicJwkMetadata =
  & Omit<JWK, "kid" | "use" | "alg">
  & { kid: string; use: "sig"; alg: "RS256" };

/**
 * Injectable service for generating, loading, and exposing RS256 JSON Web Keys.
 *
 * Wraps `@panva/jose` primitives to provide a consistent interface for key lifecycle management.
 */
@Injectable()
export class JwkService {
  /**
   * Builds a safe public JWK metadata object suitable for a JWKS endpoint response.
   *
   * Merges the raw JWK fields with enforced `kid`, `use: "sig"`, and `alg: "RS256"` values.
   *
   * @param {string} kid - The key ID to embed in the metadata.
   * @param {JWK} publicJwk - The public JWK to annotate.
   * @return {PublicJwkMetadata} Annotated public JWK metadata.
   */
  public getPublicMetadata(
    kid: string,
    publicJwk: JWK,
  ): PublicJwkMetadata {
    return {
      ...publicJwk,
      kid,
      use: "sig",
      alg: "RS256",
    };
  }

  /**
   * Imports an existing RS256 key pair from their JWK representations.
   *
   * The private JWK is consumed for import but intentionally excluded from the return value
   * to avoid accidental exposure downstream.
   *
   * @param {string} kid - The key ID associated with this key pair.
   * @param {JWK} publicJwk - Serialised public key to import.
   * @param {JWK} privateJwk - Serialised private key to import.
   * @return {Promise<Omit<JwkMetadata, "privateJwk">>} Imported key pair without the raw private JWK.
   */
  public async loadKeys(
    kid: string,
    publicJwk: JWK,
    privateJwk: JWK,
  ): Promise<Omit<JwkMetadata, "privateJwk">> {
    const publicKey = await importJWK(publicJwk, "RS256");
    const privateKey = await importJWK(privateJwk, "RS256");

    return {
      kid,
      publicKey,
      privateKey,
      publicJwk,
    };
  }

  /**
   * Generates a new RS256 key pair and returns the full {@link JwkMetadata}.
   *
   * A random UUID is assigned as the `kid`. Both `CryptoKey` objects and their JWK
   * serialisations are included in the result.
   *
   * @return {Promise<JwkMetadata>} Newly generated key pair with a unique `kid`.
   */
  public async generateKeys(): Promise<JwkMetadata> {
    const { publicKey, privateKey } = await generateKeyPair("RS256", {
      extractable: true,
    });

    const publicJwk = await exportJWK(publicKey);
    const privateJwk = await exportJWK(privateKey);

    return {
      kid: crypto.randomUUID(),
      publicKey,
      privateKey,
      publicJwk,
      privateJwk,
    };
  }
}
