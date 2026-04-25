import type {
  DynamicModule,
  InjectionToken,
  ModuleMetadata,
  Provider,
  Type,
} from "@denorid/injector";
import {
  getInjectionDependencies,
  getProviderToken,
  InjectorContext,
  isClassProvider,
} from "@denorid/injector";
import type { MockFactory } from "./mock_factory.ts";
import { TestingModule } from "./testing_module.ts";

class TestingRootModule {}

/**
 * Fluent interface returned by {@linkcode TestingModuleBuilder.overrideProvider}.
 */
export interface OverrideBuilder {
  /**
   * Replace the provider with a static value.
   *
   * @param {unknown} value - The value to use as the provider.
   * @returns {TestingModuleBuilder}
   */
  useValue(value: unknown): TestingModuleBuilder;

  /**
   * Replace the provider with a different class implementation.
   *
   * @param {Type} cls - The class to instantiate.
   * @returns {TestingModuleBuilder}
   */
  useClass(cls: Type): TestingModuleBuilder;

  /**
   * Replace the provider with a factory function.
   *
   * @param {Function} factory - The factory to invoke.
   * @param {InjectionToken[]} [inject] - Optional tokens to inject as factory arguments.
   * @returns {TestingModuleBuilder}
   */
  useFactory(
    factory: (...args: unknown[]) => unknown,
    inject?: InjectionToken[],
  ): TestingModuleBuilder;
}

/**
 * Fluent builder for constructing a {@linkcode TestingModule}.
 *
 * Obtain an instance via {@linkcode Test.createTestingModule}.
 */
export class TestingModuleBuilder {
  private readonly overrides: Provider[] = [];
  private mocker: MockFactory | undefined;

  public constructor(private readonly metadata: ModuleMetadata) {}

  /**
   * Override a provider registered under the given token.
   *
   * Overrides are applied last and therefore always win over the original
   * provider and any auto-mocked values from {@linkcode useMocker}.
   *
   * @param {InjectionToken} token - The token whose provider should be replaced.
   * @returns {OverrideBuilder}
   */
  public overrideProvider(token: InjectionToken): OverrideBuilder {
    return {
      useValue: (value: unknown): TestingModuleBuilder => {
        this.overrides.push({ provide: token, useValue: value });

        return this;
      },
      useClass: (cls: Type): TestingModuleBuilder => {
        this.overrides.push({ provide: token, useClass: cls });

        return this;
      },
      useFactory: (
        factory: (...args: unknown[]) => unknown,
        inject?: InjectionToken[],
      ): TestingModuleBuilder => {
        this.overrides.push({ provide: token, useFactory: factory, inject });

        return this;
      },
    };
  }

  /**
   * Register a factory that is called for any `@Inject`-decorated field dependency
   * that does not have a provider declared in the testing module.
   *
   * The factory receives the unresolved token and must return a mock value.
   *
   * @param {MockFactory} factory - The mock factory.
   * @returns {TestingModuleBuilder}
   */
  public useMocker(factory: MockFactory): TestingModuleBuilder {
    this.mocker = factory;

    return this;
  }

  /**
   * Compile the testing module and return a {@linkcode TestingModule}.
   *
   * @returns {Promise<TestingModule>}
   */
  public async compile(): Promise<TestingModule> {
    const originalProviders: Provider[] = [...(this.metadata.providers ?? [])];
    const mockedProviders: Provider[] = this.mocker
      ? this.buildMockedProviders(originalProviders)
      : [];

    const allProviders: Provider[] = [
      ...originalProviders,
      ...mockedProviders,
      ...this.overrides,
    ];

    const dynamicModule: DynamicModule = {
      module: TestingRootModule,
      imports: this.metadata.imports ?? [],
      providers: allProviders,
      exports: [],
    };

    const ctx = await InjectorContext.create(dynamicModule);

    return new TestingModule(ctx);
  }

  private buildMockedProviders(originalProviders: Provider[]): Provider[] {
    const declared = new Set<InjectionToken>(
      originalProviders.map(getProviderToken),
    );
    const mocked: Provider[] = [];

    for (const provider of originalProviders) {
      let targetClass: Type | undefined;

      if (typeof provider === "function") {
        targetClass = provider;
      } else if (isClassProvider(provider)) {
        targetClass = provider.useClass;
      }

      if (!targetClass) {
        continue;
      }

      for (const dep of getInjectionDependencies(targetClass)) {
        if (!declared.has(dep.token)) {
          declared.add(dep.token);
          mocked.push({
            provide: dep.token,
            useValue: this.mocker!(dep.token),
          });
        }
      }
    }

    return mocked;
  }
}

/**
 * Entry point for the Denorid testing utilities.
 *
 * @example
 * ```ts
 * const module = await Test.createTestingModule({
 *   providers: [MyService, { provide: Dep, useValue: mockDep }],
 * }).compile();
 *
 * const svc = await module.get(MyService);
 * ```
 */
export class Test {
  /**
   * Creates a {@linkcode TestingModuleBuilder} configured with the given module metadata.
   *
   * @param {ModuleMetadata} metadata - Module metadata (providers, imports).
   * @returns {TestingModuleBuilder}
   */
  public static createTestingModule(
    metadata: ModuleMetadata,
  ): TestingModuleBuilder {
    return new TestingModuleBuilder(metadata);
  }
}
