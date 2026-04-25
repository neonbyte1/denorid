import { generateKeyPair, type JWTPayload } from "@panva/jose";
import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { beforeAll, describe, it } from "@std/testing/bdd";
import type { JwtModuleOptions } from "./common.ts";
import { WrongKeyError } from "./exceptions.ts";
import { JwtService } from "./jwt_service.ts";

function createService(opts?: JwtModuleOptions): JwtService {
  const svc = new JwtService();

  (svc as unknown as Record<string, unknown>)["options"] = opts;

  return svc;
}

describe("JwtService", () => {
  let rsaPublicKey: CryptoKey;
  let rsaPrivateKey: CryptoKey;

  beforeAll(async () => {
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

  describe("getSecretKey - error paths", () => {
    it("throws WrongKeyError (privateKey scope) when no secret or key on sign", () => {
      const svc = createService(undefined);
      assertThrows(() => svc.sign({}), WrongKeyError);
    });

    it("throws WrongKeyError (publicKey scope) when no secret or key on verify", async () => {
      const svc = createService({ secret: "s" });
      const token = await svc.sign({});
      const svc2 = createService(undefined);

      assertThrows(() => svc2.verify(token), WrongKeyError);
    });
  });

  describe("decode", () => {
    it("decodes string token without signature verification", async () => {
      const svc = createService({ secret: "s" });
      const token = await svc.sign({ role: "admin" });
      const decoded = await svc.decode(token) as
        & JWTPayload
        & { role: string };

      assertEquals(decoded.role, "admin");
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
  });
});
