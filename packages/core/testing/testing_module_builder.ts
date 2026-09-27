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
import { ExceptionHandler } from "../exceptions/handler.ts";
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
  private coreGlobals = false;

  public constructor(private readonly metadata: ModuleMetadata) {}

  /**
   * Override a provider registered under the given token.
   *
   * The override replaces the provider wherever the token is declared: in the
   * testing module, in imported modules (including global ones), among the
   * core globals of {@linkcode useCoreGlobals} and among the auto-mocked
   * values of {@linkcode useMocker}. Tokens declared nowhere are not added.
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
   * Register a factory that is called for any `@Inject`-decorated field
   * dependency of the testing module's providers that nothing provides: not
   * the testing module, not the exports of its imports and not a global
   * (including the core globals of {@linkcode useCoreGlobals}).
   *
   * The factory receives the unresolved token and must return a mock value.
   * The mocks are registered as globals, so the declared providers keep
   * precedence.
   *
   * @param {MockFactory} factory - The mock factory.
   * @returns {TestingModuleBuilder}
   */
  public useMocker(factory: MockFactory): TestingModuleBuilder {
    this.mocker = factory;

    return this;
  }

  /**
   * Registers the same core global providers that application bootstrap makes
   * available, allowing feature modules to be compiled in isolation.
   *
   * @returns {TestingModuleBuilder}
   */
  public useCoreGlobals(): TestingModuleBuilder {
    this.coreGlobals = true;

    return this;
  }

  /**
   * Compile the testing module and return a {@linkcode TestingModule}.
   *
   * @returns {Promise<TestingModule>}
   */
  public async compile(): Promise<TestingModule> {
    const providers: Provider[] = this.metadata.providers ?? [];
    const dynamicModule: DynamicModule = {
      module: TestingRootModule,
      imports: this.metadata.imports ?? [],
      providers,
      exports: [],
    };
    const overrides = new Map<InjectionToken, Provider>(
      this.overrides.map((provider) => [getProviderToken(provider), provider]),
    );

    const ctx = await InjectorContext.create(dynamicModule, {
      overrides: this.overrides,
      beforeInit: (ctx: InjectorContext): void => {
        if (this.coreGlobals) {
          ctx.registerGlobal(
            ...[
              {
                provide: ExceptionHandler,
                useValue: new ExceptionHandler(ctx),
              },
              { provide: InjectorContext, useValue: ctx },
            ].map((global): Provider =>
              overrides.get(global.provide) ?? global
            ),
          );
        }

        if (this.mocker) {
          this.registerMocks(ctx, providers, this.mocker, overrides);
        }
      },
    });

    return new TestingModule(ctx);
  }

  /**
   * Registers a global mock (or the override of its token) for every field
   * dependency of the given class providers that `ctx` cannot resolve from
   * the testing module.
   *
   * @param {InjectorContext} ctx - The context before any provider was created.
   * @param {Provider[]} providers - The providers of the testing module.
   * @param {MockFactory} mocker - Creates the mock values.
   * @param {Map<InjectionToken, Provider>} overrides - The overrides by token.
   */
  private registerMocks(
    ctx: InjectorContext,
    providers: Provider[],
    mocker: MockFactory,
    overrides: Map<InjectionToken, Provider>,
  ): void {
    for (const provider of providers) {
      let targetClass: Type | undefined;

      if (typeof provider === "function") {
        targetClass = provider;
      } else if (isClassProvider(provider)) {
        targetClass = provider.useClass;
      }

      if (!targetClass) {
        continue;
      }

      for (const { token } of getInjectionDependencies(targetClass)) {
        if (!ctx.container.canResolve(token)) {
          ctx.registerGlobal(
            overrides.get(token) ?? { provide: token, useValue: mocker(token) },
          );
        }
      }
    }
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
