import { Test, type TestingModule } from "@denorid/core/testing";
import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type Type,
} from "@denorid/injector";
import { errors } from "@panva/jose";
import {
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { describe, it } from "node:test";
import { WrongKeyError } from "./exceptions.ts";
import { JwtModule } from "./jwt_module.ts";
import { JwtService } from "./jwt_service.ts";

@Injectable()
class JwtUser {
  @Inject(JwtService)
  public readonly jwt!: JwtService;
}

/**
 * Creates a module importing `jwtModule` and exporting its own consumer of
 * `JwtService`.
 *
 * @param {DynamicModule} jwtModule - The JWT module to import.
 * @return {{ feature: Type; user: Type<JwtUser> }} The feature module and
 *   its consumer class.
 */
function createFeature(
  jwtModule: DynamicModule,
): { feature: Type; user: Type<JwtUser> } {
  @Injectable()
  class User extends JwtUser {}

  @Module({ imports: [jwtModule], providers: [User], exports: [User] })
  class FeatureModule {}

  return { feature: FeatureModule, user: User };
}

async function compile(
  metadata: Parameters<typeof Test.createTestingModule>[0],
  run: (module: TestingModule) => Promise<void>,
): Promise<void> {
  const module = await Test.createTestingModule(metadata).compile();

  try {
    await run(module);
  } finally {
    await module.close();
  }
}

describe(JwtModule.name, () => {
  describe("forRoot", () => {
    it("configures the JwtService of the importing module", async () => {
      const { feature, user } = createFeature(
        JwtModule.forRoot({ secret: "secret" }),
      );

      await compile({ imports: [feature] }, async (module) => {
        const { jwt } = await module.get(user);
        const { payload } = await jwt.verify(await jwt.sign({ sub: "u1" }), {
          secret: "secret",
        });

        assertEquals(payload.sub, "u1");
      });
    });

    it("gives every registration its own JwtService and options", async () => {
      const a = createFeature(JwtModule.forRoot({ secret: "secret-a" }));
      const b = createFeature(JwtModule.forRoot({ secret: "secret-b" }));

      await compile({ imports: [a.feature, b.feature] }, async (module) => {
        const { jwt: jwtA } = await module.get(a.user);
        const { jwt: jwtB } = await module.get(b.user);

        assertNotStrictEquals(jwtA, jwtB);

        const { payload } = await jwtB.verify(await jwtB.sign({ sub: "b" }), {
          secret: "secret-b",
        });
        const tokenB = await jwtB.sign({});

        assertEquals(payload.sub, "b");
        await assertRejects(
          () => jwtA.verify(tokenB),
          errors.JWSSignatureVerificationFailed,
        );
      });
    });

    it("shares one JwtService between imports of the same registration", async () => {
      const shared = JwtModule.forRoot({ secret: "secret" });
      const a = createFeature(shared);
      const b = createFeature(shared);

      await compile({ imports: [a.feature, b.feature] }, async (module) => {
        assertStrictEquals(
          (await module.get(a.user)).jwt,
          (await module.get(b.user)).jwt,
        );
      });
    });

    it("makes a global registration available in every module", async () => {
      @Module({ providers: [JwtUser], exports: [JwtUser] })
      class FeatureModule {}

      await compile({
        imports: [
          JwtModule.forRoot({ global: true, secret: "s" }),
          FeatureModule,
        ],
      }, async (module) => {
        const { jwt } = await module.get(JwtUser);

        assertEquals(
          (await jwt.verify(await jwt.sign({ sub: "g" }))).payload.sub,
          "g",
        );
      });
    });
  });

  describe("forRootAsync", () => {
    it("configures the JwtService with the factory result of its imports and extra providers", async () => {
      const SECRET = Symbol("SECRET");
      const PREFIX = Symbol("PREFIX");

      @Module({
        providers: [{ provide: SECRET, useValue: "secret" }],
        exports: [SECRET],
      })
      class SecretModule {}

      const { feature, user } = createFeature(JwtModule.forRootAsync({
        imports: [SecretModule],
        inject: [SECRET, PREFIX],
        extraProviders: [{ provide: PREFIX, useValue: "async-" }],
        useFactory: (secret: string, prefix: string) => ({
          secret: `${prefix}${secret}`,
        }),
      }));

      await compile({ imports: [feature] }, async (module) => {
        const { jwt } = await module.get(user);
        const token = await jwt.sign({ sub: "a1" });

        assertEquals(
          (await jwt.verify(token, { secret: "async-secret" })).payload.sub,
          "a1",
        );
      });
    });

    it("keeps a signing and a verifying registration apart", async () => {
      const { privateKey, publicKey } = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      );
      const signing = createFeature(JwtModule.forRootAsync({
        useFactory: () => Promise.resolve({ privateKey }),
      }));
      const verifying = createFeature(JwtModule.forRootAsync({
        useFactory: () => ({ publicKey }),
      }));

      await compile({
        imports: [verifying.feature, signing.feature],
      }, async (module) => {
        const { jwt: signer } = await module.get(signing.user);
        const { jwt: verifier } = await module.get(verifying.user);
        const token = await signer.sign({ sub: "s1" });

        assertEquals((await verifier.verify(token)).payload.sub, "s1");
        await assertRejects(
          () => verifier.sign({}),
          WrongKeyError,
          "Wrong secret or privateKey",
        );
      });
    });
  });
});
