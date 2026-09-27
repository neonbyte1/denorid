import { parse as parseYaml } from "@std/yaml";
import fs from "node:fs/promises";
import process from "node:process";
import { parseEnv } from "node:util";
import { ConfigEnvAccessError, ConfigFileError } from "./exceptions.ts";
import type {
  ConfigFilePath,
  ConfigModuleOptions,
  ConfigRecord,
} from "./module_options.ts";

/**
 * Loads and merges every configuration source described by `options`.
 *
 * Order, later sources win: YAML files, `load` factories, `.env` files,
 * runtime environment variables. The result is passed through `validate`
 * when set.
 *
 * @param {ConfigModuleOptions} options - Module options.
 * @return {Promise<ConfigRecord>} The final configuration.
 * @throws {ConfigFileError} When a file cannot be read or parsed.
 * @throws {ConfigEnvAccessError} When the runtime environment cannot be
 * enumerated and `envVars` is not set.
 */
export async function loadConfig(
  options: ConfigModuleOptions,
): Promise<ConfigRecord> {
  let config: ConfigRecord = {};

  for (const path of toArray(options.yamlFilePath)) {
    const source = await readOptionalFile(path);

    if (source !== undefined) {
      config = mergeConfig(config, parseYamlFile(path, source));
    }
  }

  let env: Record<string, string> = {};

  for (const path of toArray(options.envFilePath ?? ".env")) {
    const source = await readOptionalFile(path);

    if (source !== undefined) {
      env = { ...env, ...definedValues(parseEnv(source)) };
    }
  }

  if (!options.ignoreEnvVars) {
    env = { ...env, ...readRuntimeEnv(options.envVars) };
  }

  Object.freeze(env);

  for (const factory of options.load ?? []) {
    config = mergeConfig(config, await factory(env));
  }

  config = mergeConfig(config, env);

  return options.validate ? await options.validate(config) : config;
}

/**
 * Deeply merges `source` into a copy of `target`. Plain objects are merged,
 * every other value replaces the existing one. Keys are defined as own data
 * properties, so `__proto__` cannot alter prototypes.
 *
 * @param {ConfigRecord} target - Base configuration.
 * @param {ConfigRecord} source - Configuration taking precedence.
 * @return {ConfigRecord} The merged configuration.
 */
export function mergeConfig(
  target: ConfigRecord,
  source: ConfigRecord,
): ConfigRecord {
  const merged = new Map(Object.entries(target));

  for (const [key, value] of Object.entries(source)) {
    const current = merged.get(key);

    merged.set(
      key,
      isPlainObject(current) && isPlainObject(value)
        ? mergeConfig(current, value)
        : value,
    );
  }

  return Object.fromEntries(merged);
}

function isPlainObject(value: unknown): value is ConfigRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function toArray(
  value: ConfigFilePath | ConfigFilePath[] | undefined,
): ConfigFilePath[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function displayPath(path: ConfigFilePath): string {
  return path instanceof URL ? path.href : path;
}

async function readOptionalFile(
  path: ConfigFilePath,
): Promise<string | undefined> {
  try {
    return await fs.readFile(path, "utf8");
  } catch (e) {
    if ((e as { code?: unknown }).code === "ENOENT") {
      return undefined;
    }

    throw new ConfigFileError(displayPath(path), "cannot be read", {
      cause: e,
    });
  }
}

function parseYamlFile(path: ConfigFilePath, source: string): ConfigRecord {
  let document: unknown;

  try {
    document = parseYaml(source) ?? {};
  } catch (e) {
    throw new ConfigFileError(displayPath(path), "is not valid YAML", {
      cause: e,
    });
  }

  if (!isPlainObject(document)) {
    throw new ConfigFileError(
      displayPath(path),
      "must contain a mapping at the top level",
    );
  }

  return document;
}

/**
 * Reads the runtime environment variables: the listed ones one by one, or
 * the whole environment when no list is given.
 *
 * @param {readonly string[] | undefined} names - Variables to read.
 * @return {Record<string, string>} The variables that are set.
 * @throws {ConfigEnvAccessError} When enumerating the environment is not
 * permitted (Deno with a scoped `--allow-env`).
 */
function readRuntimeEnv(
  names: readonly string[] | undefined,
): Record<string, string> {
  if (names) {
    return definedValues(
      Object.fromEntries(names.map((name) => [name, process.env[name]])),
    );
  }

  try {
    return definedValues(process.env);
  } catch (e) {
    // Deno 2 throws `NotCapable`, older releases `PermissionDenied`.
    if (
      e instanceof Error &&
      (e.name === "NotCapable" || e.name === "PermissionDenied")
    ) {
      throw new ConfigEnvAccessError({ cause: e });
    }

    throw e;
  }
}

function definedValues(
  dict: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dict).filter((entry): entry is [string, string] =>
      entry[1] !== undefined
    ),
  );
}
