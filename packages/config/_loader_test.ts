import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import process from "node:process";
import { describe, it } from "node:test";
import { loadConfig, mergeConfig } from "./_loader.ts";
import { setEnv, stubFiles } from "./_test_fixtures.ts";
import { ConfigEnvAccessError, ConfigFileError } from "./exceptions.ts";
import type { ConfigRecord } from "./module_options.ts";

/**
 * Replaces `process.env` with an object whose enumeration throws `error`.
 *
 * @param {Error} error - Error thrown when the environment is enumerated.
 * @return {Disposable} Restores the real `process.env` when disposed.
 */
function replaceEnv(error: Error): Disposable {
  const original = Object.getOwnPropertyDescriptor(process, "env")!;

  Object.defineProperty(process, "env", {
    configurable: true,
    value: new Proxy({}, {
      ownKeys(): never {
        throw error;
      },
    }),
  });

  return {
    [Symbol.dispose](): void {
      Object.defineProperty(process, "env", original);
    },
  };
}
describe("loadConfig", () => {
  describe("yaml files", () => {
    it("deep merges files in order, later files win", async () => {
      using _files = stubFiles({
        "base.yaml": [
          "database:",
          "  host: localhost",
          "  port: 5432",
          "  replicas: [a, b]",
          "name: base",
        ].join("\n"),
        "local.yaml": [
          "database:",
          "  port: 6543",
          "  replicas: [c]",
          "debug: true",
        ].join("\n"),
      });

      const config = await loadConfig({
        yamlFilePath: ["base.yaml", "local.yaml"],
        ignoreEnvVars: true,
      });

      assertEquals(config, {
        database: { host: "localhost", port: 6543, replicas: ["c"] },
        name: "base",
        debug: true,
      });
    });

    it("accepts a single path and URLs", async () => {
      const url = new URL("file:///srv/app/config.yaml");

      using _files = stubFiles({
        "single.yaml": "a: 1",
        [url.href]: "b: 2",
      });

      assertEquals(
        await loadConfig({ yamlFilePath: "single.yaml", ignoreEnvVars: true }),
        { a: 1 },
      );
      assertEquals(
        await loadConfig({ yamlFilePath: [url], ignoreEnvVars: true }),
        { b: 2 },
      );
    });

    it("skips missing files and treats empty documents as empty", async () => {
      using _files = stubFiles({ "empty.yaml": "", "null.yaml": "~" });

      const config = await loadConfig({
        yamlFilePath: ["missing.yaml", "empty.yaml", "null.yaml"],
        ignoreEnvVars: true,
      });

      assertEquals(config, {});
    });

    it("rejects documents without a top level mapping", async () => {
      using _files = stubFiles({
        "list.yaml": "- a\n- b",
        "scalar.yaml": "just text",
      });

      for (const path of ["list.yaml", "scalar.yaml"]) {
        const error = await assertRejects(
          () => loadConfig({ yamlFilePath: path, ignoreEnvVars: true }),
          ConfigFileError,
          `Config file "${path}": must contain a mapping at the top level`,
        );

        assertEquals(error.path, path);
        assertEquals(error.name, "ConfigFileError");
      }
    });

    it("wraps parse errors with the file location", async () => {
      const url = new URL("file:///srv/app/broken.yaml");

      using _files = stubFiles({ [url.href]: "a: [1, 2" });

      const error = await assertRejects(
        () => loadConfig({ yamlFilePath: url, ignoreEnvVars: true }),
        ConfigFileError,
        `Config file "${url.href}": is not valid YAML`,
      );

      assertInstanceOf(error.cause, Error);
    });

    it("wraps read errors other than ENOENT", async () => {
      const denied = Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });

      using _files = stubFiles({ "secret.yaml": denied });

      const error = await assertRejects(
        () => loadConfig({ yamlFilePath: "secret.yaml", ignoreEnvVars: true }),
        ConfigFileError,
        'Config file "secret.yaml": cannot be read',
      );

      assertStrictEquals(error.cause, denied);
    });
  });

  describe("env files", () => {
    it("loads .env from the working directory by default", async () => {
      using _files = stubFiles({ ".env": "PORT=8080\nNAME='denorid'" });

      assertEquals(await loadConfig({ ignoreEnvVars: true }), {
        PORT: "8080",
        NAME: "denorid",
      });
    });

    it("merges env files in order and loads none for an empty list", async () => {
      using _files = stubFiles({
        ".env": "IGNORED=1",
        "a.env": "PORT=1\nHOST=a",
        "b.env": "PORT=2",
      });

      assertEquals(
        await loadConfig({
          envFilePath: ["a.env", "missing.env", "b.env"],
          ignoreEnvVars: true,
        }),
        { PORT: "2", HOST: "a" },
      );
      assertEquals(
        await loadConfig({ envFilePath: [], ignoreEnvVars: true }),
        {},
      );
    });

    it("lets runtime environment variables override env files", async () => {
      using _env = setEnv({ DENORID_CONFIG_LOADER_TEST: "runtime" });
      using _files = stubFiles({
        ".env": "DENORID_CONFIG_LOADER_TEST=file\nDENORID_CONFIG_FILE_ONLY=1",
      });

      const config = await loadConfig({});

      assertEquals(config.DENORID_CONFIG_LOADER_TEST, "runtime");
      assertEquals(config.DENORID_CONFIG_FILE_ONLY, "1");
    });

    it("skips runtime environment variables when ignoreEnvVars is set", async () => {
      using _env = setEnv({ DENORID_CONFIG_LOADER_TEST: "runtime" });
      using _files = stubFiles({});

      const config = await loadConfig({ ignoreEnvVars: true });

      assertEquals(config.DENORID_CONFIG_LOADER_TEST, undefined);
    });

    it("reads only the variables listed in envVars", async () => {
      using _env = setEnv({
        DENORID_CONFIG_LISTED: "listed",
        DENORID_CONFIG_UNLISTED: "unlisted",
      });
      using _files = stubFiles({});

      const config = await loadConfig({
        envVars: ["DENORID_CONFIG_LISTED", "DENORID_CONFIG_UNSET"],
      });

      assertEquals(config.DENORID_CONFIG_LISTED, "listed");
      assertEquals("DENORID_CONFIG_UNLISTED" in config, false);
      assertEquals("DENORID_CONFIG_UNSET" in config, false);
    });

    it("explains how to proceed when the environment cannot be enumerated", async () => {
      const cause = Object.assign(new Error("Requires env access"), {
        name: "NotCapable",
      });
      using _files = stubFiles({});
      using _env = replaceEnv(cause);

      const error = await assertRejects(
        () => loadConfig({}),
        ConfigEnvAccessError,
        "list the variables in `envVars`",
      );

      assertStrictEquals(error.cause, cause);
    });

    it("rethrows other errors while enumerating the environment", async () => {
      using _files = stubFiles({});
      using _env = replaceEnv(new TypeError("broken env"));

      await assertRejects(() => loadConfig({}), TypeError, "broken env");
    });

    it("works with a scoped --allow-env flag when envVars lists the names", async () => {
      const loader = new URL("./_loader.ts", import.meta.url).href;
      const script = [
        `import { loadConfig } from ${JSON.stringify(loader)};`,
        `const listed = await loadConfig({ envFilePath: [], envVars: ["PORT"] });`,
        `const all = await loadConfig({ envFilePath: [] }).then(`,
        `  () => "loaded",`,
        `  (e) => e.name,`,
        `);`,
        `console.log(JSON.stringify({ port: listed.PORT, all }));`,
      ].join("\n");
      // `deno eval` always grants every permission, so run a file instead.
      const file = await Deno.makeTempFile({ suffix: ".ts" });

      try {
        await Deno.writeTextFile(file, script);

        const output = await new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--no-prompt",
            "--config",
            new URL("./deno.json", import.meta.url).pathname,
            "--allow-env=PORT",
            "--allow-read",
            file,
          ],
          env: { PORT: "8080" },
          stdout: "piped",
          stderr: "piped",
        }).output();

        assertEquals(
          new TextDecoder().decode(output.stdout).trim(),
          JSON.stringify({ port: "8080", all: "ConfigEnvAccessError" }),
          new TextDecoder().decode(output.stderr),
        );
      } finally {
        await Deno.remove(file);
      }
    });
  });

  describe("load factories", () => {
    it("merges factories in order between yaml files and env variables", async () => {
      using _files = stubFiles({
        "config.yaml": "database:\n  host: yaml\n  port: 1\nPORT: yaml",
        ".env": "PORT=env",
      });

      const received: Readonly<Record<string, string>>[] = [];

      const config = await loadConfig({
        yamlFilePath: "config.yaml",
        ignoreEnvVars: true,
        load: [
          (env) => {
            received.push(env);

            return { database: { port: 2 }, PORT: "factory", extra: "a" };
          },
          (env) => {
            received.push(env);

            return Promise.resolve({ extra: "b" });
          },
        ],
      });

      assertEquals(config, {
        database: { host: "yaml", port: 2 },
        PORT: "env",
        extra: "b",
      });
      assertEquals(received, [{ PORT: "env" }, { PORT: "env" }]);
      assert(Object.isFrozen(received[0]));
    });
  });

  describe("validate", () => {
    it("exposes the value returned by validate", async () => {
      using _files = stubFiles({ ".env": "PORT=8080" });

      const seen: ConfigRecord[] = [];

      const config = await loadConfig({
        ignoreEnvVars: true,
        validate: (raw) => {
          seen.push(raw);

          return Promise.resolve({ port: Number(raw.PORT) });
        },
      });

      assertEquals(seen, [{ PORT: "8080" }]);
      assertEquals(config, { port: 8080 });
    });

    it("propagates validation errors", async () => {
      using _files = stubFiles({});

      await assertRejects(
        () =>
          loadConfig({
            ignoreEnvVars: true,
            validate: () => {
              throw new RangeError("PORT is required");
            },
          }),
        RangeError,
        "PORT is required",
      );
    });
  });
});

describe("mergeConfig", () => {
  it("does not mutate its inputs", () => {
    const target = { a: { b: 1 } };
    const source = { a: { c: 2 } };

    assertEquals(mergeConfig(target, source), { a: { b: 1, c: 2 } });
    assertEquals(target, { a: { b: 1 } });
    assertEquals(source, { a: { c: 2 } });
  });

  it("merges null prototype objects but replaces class instances", () => {
    const bare = Object.assign(Object.create(null), { b: 2 });
    const date = new Date(0);

    const merged = mergeConfig(
      { a: { a: 1 }, when: { year: 1970 } },
      { a: bare, when: date },
    );

    assertEquals(merged.a, { a: 1, b: 2 });
    assertStrictEquals(merged.when, date);
  });

  it("keeps __proto__ keys as own data without touching prototypes", () => {
    const source = JSON.parse('{"__proto__": {"polluted": true}}');

    const merged = mergeConfig({}, source);

    assertStrictEquals(Object.getPrototypeOf(merged), Object.prototype);
    assert(Object.hasOwn(merged, "__proto__"));
    assertEquals(({} as { polluted?: boolean }).polluted, undefined);
  });
});
