import { createSecretKey, generateKeyPairSync } from "node:crypto";
import {
  base64url,
  decodeProtectedHeader,
  errors,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
} from "@panva/jose";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
} from "@std/assert";
import { before, describe, it } from "node:test";
import type { JwtModuleOptions, KeyType } from "./common.ts";
import { WrongKeyError } from "./exceptions.ts";
import { JwtService } from "./jwt_service.ts";

function createService(opts?: JwtModuleOptions): JwtService {
  const svc = new JwtService();

  (svc as unknown as Record<string, unknown>)["options"] = opts;

  return svc;
}

interface SigningKeys {
  privateKey: KeyType;
  publicKey: KeyType;
}

async function exportPair(
  alg: string,
  jwkAlg?: string,
): Promise<SigningKeys> {
  const pair = await generateKeyPair(alg, { extractable: true });

  return {
    privateKey: { ...await exportJWK(pair.privateKey), alg: jwkAlg },
    publicKey: { ...await exportJWK(pair.publicKey), alg: jwkAlg },
  };
}

describe("JwtService", () => {
  let rsaPublicKey: CryptoKey;
  let rsaPrivateKey: CryptoKey;

  before(async () => {
    const pair = await generateKeyPair("RS256");

    rsaPublicKey = pair.publicKey as CryptoKey;
    rsaPrivateKey = pair.privateKey as CryptoKey;
  });

  describe("sign + verify (HS256 / secret)", () => {
    it("uses per-op string secret (string -> TextEncoder encode branch)", async () => {
      const svc = createService();
      const token = await svc.sign({ sub: "u1" }, { secret: "s" });
      const result = await svc.verify(token, { secret: "s" });

      assertEquals(result.payload.sub, "u1");
    });

    it("falls back to module secret when no per-op secret", async () => {
      const svc = createService({ secret: "ms" });
      const token = await svc.sign({ sub: "u2" });
      const result = await svc.verify(token, { secret: "ms" });

      assertEquals(result.payload.sub, "u2");
    });

    it("uses per-op Uint8Array secret (non-string -> return-as-is branch)", async () => {
      const key = new TextEncoder().encode("bin-secret");
      const svc = createService();
      const token = await svc.sign({ sub: "u3" }, { secret: key });
      const result = await svc.verify(token, { secret: key });

      assertEquals(result.payload.sub, "u3");
    });
  });

  describe("sign + verify (RS256 / asymmetric)", () => {
    it("uses per-op privateKey for sign, per-op publicKey for verify", async () => {
      const svc = createService();
      const token = await svc.sign(
        { sub: "u4" },
        { privateKey: rsaPrivateKey },
      );
      const result = await svc.verify(token, { publicKey: rsaPublicKey });

      assertEquals(result.payload.sub, "u4");
    });

    it("uses module privateKey for sign, module publicKey for verify", async () => {
      const svc = createService({
        publicKey: rsaPublicKey,
        privateKey: rsaPrivateKey,
      });
      const token = await svc.sign({ sub: "u5" });
      const result = await svc.verify(token);

      assertEquals(result.payload.sub, "u5");
    });
  });

  describe("per-op keys override module keys", () => {
    it("signs with per-op privateKey and verifies with per-op publicKey when the module has a secret", async () => {
      const svc = createService({ secret: "module-secret" });
      const token = await svc.sign(
        { sub: "u6" },
        { privateKey: rsaPrivateKey },
      );
      const result = await svc.verify(token, { publicKey: rsaPublicKey });

      assertEquals(result.protectedHeader.alg, "RS256");
      assertEquals(result.payload.sub, "u6");
    });

    it("signs and verifies with per-op secret when the module has a key pair", async () => {
      const svc = createService({
        publicKey: rsaPublicKey,
        privateKey: rsaPrivateKey,
      });
      const token = await svc.sign({ sub: "u7" }, { secret: "other-secret" });
      const result = await svc.verify(token, { secret: "other-secret" });

      assertEquals(result.protectedHeader.alg, "HS256");
      assertEquals(result.payload.sub, "u7");
    });

    it("applies the module protectedHeader.alg to the module key only", async () => {
      const svc = createService({
        secret: "s",
        signOptions: { protectedHeader: { alg: "HS512" } },
      });
      const moduleToken = await svc.sign({});
      const perOpToken = await svc.sign({}, { privateKey: rsaPrivateKey });

      assertEquals(decodeProtectedHeader(moduleToken).alg, "HS512");
      assertEquals(decodeProtectedHeader(perOpToken).alg, "RS256");
    });

    it("prefers a per-op protectedHeader.alg over the inferred algorithm", async () => {
      const svc = createService({ secret: "s" });
      const token = await svc.sign({}, { protectedHeader: { alg: "HS384" } });
      const result = await svc.verify(token);

      assertEquals(result.protectedHeader.alg, "HS384");
    });
  });

  describe("sign - algorithm inference", () => {
    const inferable: [string, string, () => Promise<SigningKeys>][] = [
      ["HMAC SHA-512 CryptoKey", "HS512", async () => {
        const key = await crypto.subtle.generateKey(
          { name: "HMAC", hash: "SHA-512" },
          false,
          ["sign", "verify"],
        );

        return { privateKey: key, publicKey: key };
      }],
      [
        "RSASSA-PKCS1-v1_5 SHA-512 CryptoKey",
        "RS512",
        () => generateKeyPair("RS512"),
      ],
      ["RSA-PSS SHA-384 CryptoKey", "PS384", () => generateKeyPair("PS384")],
      ["ECDSA P-256 CryptoKey", "ES256", () => generateKeyPair("ES256")],
      ["ECDSA P-384 CryptoKey", "ES384", () => generateKeyPair("ES384")],
      ["ECDSA P-521 CryptoKey", "ES512", () => generateKeyPair("ES512")],
      ["Ed25519 CryptoKey", "EdDSA", () => generateKeyPair("Ed25519")],
      ["RSA JWK", "RS256", () => exportPair("RS256")],
      ["EC P-384 JWK", "ES384", () => exportPair("ES384")],
      ["Ed25519 JWK", "EdDSA", () => exportPair("Ed25519")],
      ["JWK with an alg member", "PS256", () => exportPair("RS256", "PS256")],
      ["oct JWK", "HS256", () => {
        const key = {
          kty: "oct",
          k: base64url.encode("0123456789abcdef0123456789abcdef"),
        };

        return Promise.resolve({ privateKey: key, publicKey: key });
      }],
      ["secret KeyObject", "HS256", () => {
        const key = createSecretKey(
          new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
        );

        return Promise.resolve({ privateKey: key, publicKey: key });
      }],
      [
        "RSA KeyObject",
        "RS256",
        () =>
          Promise.resolve(generateKeyPairSync("rsa", { modulusLength: 2048 })),
      ],
      [
        "EC P-256 KeyObject",
        "ES256",
        () =>
          Promise.resolve(generateKeyPairSync("ec", { namedCurve: "P-256" })),
      ],
      [
        "Ed25519 KeyObject",
        "EdDSA",
        () => Promise.resolve(generateKeyPairSync("ed25519")),
      ],
    ];

    for (const [name, alg, createKeys] of inferable) {
      it(`signs with ${alg} for a ${name}`, async () => {
        const { privateKey, publicKey } = await createKeys();
        const svc = createService();
        const token = await svc.sign({ sub: name }, { privateKey });
        const result = await svc.verify(token, { publicKey });

        assertEquals(result.protectedHeader.alg, alg);
        assertEquals(result.payload.sub, name);
      });
    }

    const uninferable: [string, () => Promise<KeyType>][] = [
      [
        "HMAC SHA-1 CryptoKey",
        () =>
          crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-1" }, false, [
            "sign",
          ]),
      ],
      [
        "AES-GCM CryptoKey",
        () =>
          crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
            "encrypt",
          ]),
      ],
      [
        "X25519 KeyObject",
        () => Promise.resolve(generateKeyPairSync("x25519").privateKey),
      ],
      [
        "EC JWK on an unsupported curve",
        () =>
          Promise.resolve({
            kty: "EC",
            crv: "secp256k1",
            x: "x",
            y: "y",
            d: "d",
          }),
      ],
      [
        "OKP JWK on the X25519 curve",
        () => Promise.resolve({ kty: "OKP", crv: "X25519", x: "x", d: "d" }),
      ],
      [
        "JWK of an unknown key type",
        () => Promise.resolve({ kty: "AKP", pub: "pub", priv: "priv" }),
      ],
    ];

    for (const [name, createKey] of uninferable) {
      it(`rejects with TypeError for a ${name}`, async () => {
        const privateKey = await createKey();

        await assertRejects(
          () => createService().sign({}, { privateKey }),
          TypeError,
          "Cannot infer the JWS algorithm",
        );
      });
    }
  });

  describe("sign - optional JWT claims", () => {
    it("sets all optional claims when provided", async () => {
      const svc = createService();
      const nbfDate = new Date(Date.now() - 5000);
      const token = await svc.sign(
        {},
        {
          secret: "s",
          iss: "issuer",
          sub: "subject",
          aud: "audience",
          jti: "unique-jti",
          nbf: nbfDate,
          exp: "1h",
          protectedHeader: { kid: "my-kid" },
        },
      );
      const result = await svc.verify(token, {
        secret: "s",
        issuer: "issuer",
        subject: "subject",
        audience: "audience",
      });

      assertEquals(result.payload.iss, "issuer");
      assertEquals(result.payload.jti, "unique-jti");
      assertExists(result.payload.nbf);
      assertExists(result.payload.exp);
    });

    it("omits all optional claims when not provided", async () => {
      const svc = createService();
      const token = await svc.sign({ custom: "data" }, { secret: "s" });
      const decoded = await svc.decode(token);

      assertEquals(decoded.iss, undefined);
      assertEquals(decoded.sub, undefined);
      assertEquals(decoded.aud, undefined);
      assertEquals(decoded.jti, undefined);
      assertEquals(decoded.nbf, undefined);
      assertEquals(decoded.exp, undefined);
    });
  });

  describe("getSignOptions", () => {
    it("merges module signOptions with per-op options (per-op wins)", async () => {
      const svc = createService({
        secret: "s",
        signOptions: { iss: "module-issuer", sub: "module-sub" },
      });
      const token = await svc.sign({}, { secret: "s", sub: "op-sub" });
      const decoded = await svc.decode(token);

      assertEquals(decoded.iss, "module-issuer");
      assertEquals(decoded.sub, "op-sub");
    });

    it("merges module and per-op protectedHeader parameters (per-op wins)", async () => {
      const svc = createService({
        secret: "s",
        signOptions: { protectedHeader: { kid: "k1", typ: "JWT" } },
      });
      const token = await svc.sign({}, { protectedHeader: { typ: "at+jwt" } });

      assertEquals(decodeProtectedHeader(token), {
        alg: "HS256",
        kid: "k1",
        typ: "at+jwt",
      });
    });

    it("works when per-op options is undefined", async () => {
      const svc = createService({ secret: "s", signOptions: { iss: "i" } });
      const token = await svc.sign({}, undefined);
      const decoded = await svc.decode(token);

      assertEquals(decoded.iss, "i");
    });

    it("works when module signOptions is absent", async () => {
      const svc = createService({ secret: "s" });
      const token = await svc.sign({});

      assertExists(token);
    });
  });

  describe("verify - module verifyOptions", () => {
    it("rejects tokens whose claims violate module verifyOptions", async () => {
      const svc = createService({
        secret: "s",
        verifyOptions: { issuer: "expected-iss", audience: "expected-aud" },
      });
      const token = await svc.sign({}, { iss: "attacker", aud: "other" });

      await assertRejects(
        () => svc.verify(token),
        errors.JWTClaimValidationFailed,
      );
    });

    it("accepts tokens whose claims satisfy module verifyOptions", async () => {
      const svc = createService({
        secret: "s",
        verifyOptions: { issuer: "expected-iss", audience: "expected-aud" },
      });
      const token = await svc.sign({}, {
        iss: "expected-iss",
        aud: "expected-aud",
      });
      const result = await svc.verify(token);

      assertEquals(result.payload.iss, "expected-iss");
    });

    it("rejects algorithms outside module verifyOptions.algorithms", async () => {
      const svc = createService({
        secret: "s",
        verifyOptions: { algorithms: ["HS512"] },
      });
      const token = await svc.sign({});

      await assertRejects(() => svc.verify(token), errors.JOSEAlgNotAllowed);
    });

    it("lets per-op options replace individual module verifyOptions fields", async () => {
      const svc = createService({
        secret: "s",
        verifyOptions: { issuer: "module-iss", audience: "expected-aud" },
      });
      const accepted = await svc.sign({}, {
        iss: "op-iss",
        aud: "expected-aud",
      });
      const rejected = await svc.sign({}, { iss: "op-iss", aud: "other" });

      assertEquals(
        (await svc.verify(accepted, { issuer: "op-iss" })).payload.iss,
        "op-iss",
      );
      await assertRejects(
        () => svc.verify(rejected, { issuer: "op-iss" }),
        errors.JWTClaimValidationFailed,
      );
    });
  });

  describe("getSecretKey - error paths", () => {
    it("rejects with WrongKeyError (privateKey scope) when no secret or key on sign", async () => {
      const svc = createService(undefined);

      await assertRejects(
        () => svc.sign({}),
        WrongKeyError,
        "Wrong secret or privateKey",
      );
    });

    it("rejects with WrongKeyError (publicKey scope) when no secret or key on verify", async () => {
      const svc = createService({ secret: "s" });
      const token = await svc.sign({});
      const svc2 = createService(undefined);

      await assertRejects(
        () => svc2.verify(token),
        WrongKeyError,
        "Wrong secret or publicKey",
      );
    });
  });

  describe("decode", () => {
    it("decodes string token without signature verification", async () => {
      const svc = createService({ secret: "s" });
      const token = await svc.sign({ role: "admin" });
      const pending = svc.decode<{ role: string }>(token);

      assertInstanceOf(pending, Promise);
      assertEquals((await pending).role, "admin");
    });

    it("decodes Uint8Array token via TextDecoder", async () => {
      const svc = createService({ secret: "s" });
      const token = await svc.sign({ role: "user" });
      const bytes = new TextEncoder().encode(token);
      const decoded = await svc.decode(bytes) as
        & JWTPayload
        & { role: string };

      assertEquals(decoded.role, "user");
    });

    it("rejects instead of throwing for a malformed token", async () => {
      await assertRejects(
        () => createService().decode("garbage"),
        errors.JWTInvalid,
      );
    });
  });
});
