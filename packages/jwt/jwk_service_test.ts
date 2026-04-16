import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { JwkService } from "./jwk_service.ts";

describe("JwkService", () => {
  const service = new JwkService();

  describe("getPublicMetadata", () => {
    it("merges JWK fields with enforced kid/use/alg", () => {
      const publicJwk = { kty: "RSA", n: "abc", e: "AQAB" };
      const result = service.getPublicMetadata("test-kid", publicJwk);

      assertEquals(result.kid, "test-kid");
      assertEquals(result.use, "sig");
      assertEquals(result.alg, "RS256");
      assertEquals(result.kty, "RSA");
      assertEquals(result.n, "abc");
      assertEquals(result.e, "AQAB");
    });
  });

  describe("loadKeys", () => {
    it("imports key pair from JWKs and excludes privateJwk from result", async () => {
      const generated = await service.generateKeys();
      const result = await service.loadKeys(
        generated.kid,
        generated.publicJwk,
        generated.privateJwk,
      );

      assertEquals(result.kid, generated.kid);
      assertEquals(result.publicJwk, generated.publicJwk);
      assertExists(result.publicKey);
      assertExists(result.privateKey);
      assertEquals("privateJwk" in result, false);
    });
  });

  describe("generateKeys", () => {
    it("returns full JwkMetadata with all required fields", async () => {
      const result = await service.generateKeys();

      assertExists(result.kid);
      assertExists(result.publicKey);
      assertExists(result.privateKey);
      assertExists(result.publicJwk);
      assertExists(result.privateJwk);
    });

    it("generates unique kid per call", async () => {
      const a = await service.generateKeys();
      const b = await service.generateKeys();

      assertNotEquals(a.kid, b.kid);
    });
  });
});
