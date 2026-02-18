import {
  getModuleMetadata,
  getProviderToken,
  isDynamicModule,
  isGlobalModule,
} from "./_internal.ts";
import type { InjectionToken, Type } from "./common.ts";
import { ModuleCompilationError } from "./errors.ts";
import type { DynamicModule, ModuleMetadata } from "./modules.ts";
import type { Provider } from "./provider.ts";

/**
 * Interface of baked or compiled modules to cache.
 *
 * @internal
 */
export interface CompiledModule {
  /**
   * Referenced module class.
   */
  type: Type;

  /**
   * An array or registered providers.
   */
  providers: Provider[];

  /**
   * A list of available injection tokens. Only those can be accessed outside
   * the related module context.
   */
  exports: Set<InjectionToken>;

  /**
   * If `true`, every module has access to this module.
   */
  isGlobal: boolean;

  /**
   * List of sub- or child modules.
   */
  imports: CompiledModule[];

  /**
   * List of tokens available in the current module context.
   */
  ownTokens: Set<InjectionToken>;
}

export class ModuleCompiler {
  private compiledModules: Map<Type, CompiledModule> = new Map();
  private dynamicModuleCache: Map<DynamicModule, CompiledModule> = new Map();
  private globalProviders: Provider[] = [];

  /**
   * Compile a module and all its imports (depth-first)
   *
   * @async
   * @param {Type|DynamicModule} moduleType
   * @returns {Promise<CompiledModule>} The function returns a `Promise` that resolves into
   *          the {@linkcode CompiledModule} when fulfilled.
   */
  public async compile(
    moduleType: Type | DynamicModule,
  ): Promise<CompiledModule> {
    if (isDynamicModule(moduleType)) {
      if (this.dynamicModuleCache.has(moduleType)) {
        return this.dynamicModuleCache.get(moduleType)!;
      }
    }

    const { type, metadata, isGlobal } = await this.resolveModule(moduleType);

    if (!isDynamicModule(moduleType) && this.compiledModules.has(type)) {
      return this.compiledModules.get(type)!;
    }

    const ownProviders = metadata.providers ?? [];
    const ownTokens = new Set<InjectionToken>(
      ownProviders.map((p) => getProviderToken(p)),
    );

    ownTokens.add(type);

    const compiled: CompiledModule = {
      type,
      providers: [],
      ownTokens,
      exports: new Set(metadata.exports ?? []),
      isGlobal,
      imports: [],
    };

    if (isDynamicModule(moduleType)) {
      this.dynamicModuleCache.set(moduleType, compiled);
    } else {
      this.compiledModules.set(type, compiled);
    }

    const importedProviders: Provider[] = [];

    for await (const importItem of metadata.imports ?? []) {
      const importedModule = await this.compile(importItem);

      compiled.imports.push(importedModule);
      importedProviders.push(...importedModule.providers);
    }

    compiled.providers = [...importedProviders, ...ownProviders];

    if (isGlobal) {
      this.globalProviders.push(...(metadata.providers ?? []));
    }

    return compiled;
  }

  /**
   * Get all global providers collected during compilation
   */
  public getGlobalProviders(): Provider[] {
    return [...this.globalProviders];
  }

  /**
   * Get all compiled modules in initialization order.
   *
   * @param {CompiledModule} root - The compiled root module responsible for bootstrapping
   * @returns {CompiledModule[]} The function returns an array of {@linkcode CompiledModule}
   *          in initialization order (depth-first).
   */
  public getModulesInInitOrder(root: CompiledModule): CompiledModule[] {
    const visited = new Set<CompiledModule>();
    const result: CompiledModule[] = [];

    const visit = (mod: CompiledModule) => {
      if (!visited.has(mod)) {
        visited.add(mod);

        for (const imported of mod.imports) {
          visit(imported);
        }

        result.push(mod);
      }
    };

    visit(root);

    return result;
  }

  /**
   * Get all compiled modules in destroy order (reverse of init order).
   *
   * @param {CompiledModule} root - The compiled root module responsible for bootstrapping
   * @returns {CompiledModule[]} - The function returns an array of {@linkcode CompiledModule}
   *          in reversed order.
   */
  public getModulesInDestroyOrder(root: CompiledModule): CompiledModule[] {
    return this.getModulesInInitOrder(root).reverse();
  }

  /**
   * Clear compilation cache.
   */
  public clear(): void {
    this.compiledModules.clear();
    this.dynamicModuleCache.clear();
    this.globalProviders = [];
  }

  /**
   * Resolve a module type or dynamic module to its metadata
   *
   * @async
   * @param {Type|DynamicModule|Promise<DynamicModule>} moduleType
   * @internal
   */
  private async resolveModule(
    moduleType: Type | DynamicModule | Promise<DynamicModule>,
  ): Promise<{ type: Type; metadata: ModuleMetadata; isGlobal: boolean }> {
    const resolved = await Promise.resolve(moduleType);

    if (isDynamicModule(resolved)) {
      const staticMetadata = getModuleMetadata(resolved.module) ?? {};
      return {
        type: resolved.module,
        metadata: {
          imports: [
            ...(staticMetadata.imports ?? []),
            ...(resolved.imports ?? []),
          ],
          providers: [
            ...(staticMetadata.providers ?? []),
            ...(resolved.providers ?? []),
          ],
          exports: [
            ...(staticMetadata.exports ?? []),
            ...(resolved.exports ?? []),
          ],
        },
        isGlobal: resolved.global ?? isGlobalModule(resolved.module),
      };
    }

    const type = resolved as Type;
    const metadata = getModuleMetadata(type);

    if (!metadata) {
      throw new ModuleCompilationError(
        `Class "${type.name}" is not decorated with @Module()`,
      );
    }

    return {
      type,
      metadata,
      isGlobal: isGlobalModule(type),
    };
  }
}
