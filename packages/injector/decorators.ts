import type { InjectableMetadata, InjectionDependency } from "./_metadata.ts";
import type {
  Decorator,
  InjectableOptions,
  InjectionExpression,
  InjectionToken,
  InjectOptions,
  Tag,
} from "./common.ts";
import {
  GLOBAL_MODULE_METADATA,
  INJECTABLE_METADATA,
  INJECTION_METADATA,
  MODULE_METADATA,
  TAG_METADATA,
} from "./constants.ts";
import { InvalidStaticMemberDecoratorUsageError } from "./errors.ts";
import type { ModuleMetadata } from "./modules.ts";

/**
 * Marks a class field for dependency injection.
 *
 * @param {InjectionToken} token - The token to resolve and inject.
 * @param {InjectOptions} [options] - Optional injection configuration.
 *
 * @example Usage
 * ```ts
 * \@Injectable()
 * class UserService {
 *   \@Inject(Logger)
 *   private logger!: Logger;
 *
 *   \@Inject(CONFIG_TOKEN)
 *   private config!: Config;
 * }
 * ```
 */
export function Inject(
  token: InjectionToken,
  options?: InjectOptions,
): Decorator<ClassFieldDecoratorContext>;

/**
 * Marks a class field for dependency injection with an expression callback.
 *
 * The resolved instance is passed to `expression`; its return value
 * (which may be a `Promise`) is awaited and becomes the field value.
 *
 * @param {InjectionToken<T>} token - The token to resolve.
 * @param {InjectionExpression<T>} expression - Receives the resolved instance; return value becomes the field value.
 *
 * @example Sync expression
 * ```ts
 * \@Inject(ConfigService, (cfg) => cfg.dbUrl)
 * private dbUrl!: string;
 * ```
 *
 * @example Async expression
 * ```ts
 * \@Inject(FeatureFlagService, async (svc) => await svc.isEnabled("myFlag"))
 * private myFlagEnabled!: boolean;
 * ```
 */
export function Inject<T>(
  token: InjectionToken<T>,
  expression: InjectionExpression<T>,
): Decorator<ClassFieldDecoratorContext>;

/**
 * Marks a class field for dependency injection with an expression callback and options.
 *
 * @param {InjectionToken<T>} token - The token to resolve.
 * @param {InjectionExpression<T>} expression - Receives the resolved instance; return value becomes the field value.
 * @param {InjectOptions} options - Optional injection configuration.
 */
export function Inject<T>(
  token: InjectionToken<T>,
  expression: InjectionExpression<T>,
  options: InjectOptions,
): Decorator<ClassFieldDecoratorContext>;

export function Inject<T>(
  token: InjectionToken<T>,
  expressionOrOptions?: InjectionExpression<T> | InjectOptions,
  options?: InjectOptions,
): Decorator<ClassFieldDecoratorContext> {
  return (_: unknown, ctx: ClassFieldDecoratorContext): void => {
    if (ctx.static) {
      throw new InvalidStaticMemberDecoratorUsageError(
        "Inject",
        ctx.name,
        "property",
      );
    }

    const dependencies =
      (ctx.metadata[INJECTION_METADATA] ??= []) as InjectionDependency[];

    if (dependencies.some(({ field }) => field === ctx.name)) {
      throw new Error(
        `Cannot inject multiple tokens into the same field: ${
          String(ctx.name)
        }`,
      );
    }

    const expression = typeof expressionOrOptions === "function"
      ? (expressionOrOptions as InjectionExpression<T>)
      : undefined;

    const resolvedOptions = typeof expressionOrOptions === "function"
      ? options
      : (expressionOrOptions as InjectOptions | undefined);

    dependencies.push({
      field: ctx.name,
      token: token as InjectionToken,
      options: resolvedOptions,
      expression: expression as InjectionExpression | undefined,
    });
  };
}

/**
 * Marks a class as injectable (can be provided and injected).
 *
 * @example Usage
 * ```ts
 * \@Injectable()
 * class Logger { }
 *
 * \@Injectable({ mode: "transient" })
 * class RequestHandler { }
 *
 * \@Injectable({ mode: "request" })
 * class RequestContext { }
 * ```
 */
export function Injectable(
  options?: InjectableOptions,
): Decorator<ClassDecoratorContext> {
  return (_: unknown, ctx: ClassDecoratorContext): void => {
    ctx.metadata[INJECTABLE_METADATA] ??= {
      ...(options ?? {}),
      id: crypto.randomUUID(),
    } satisfies InjectableMetadata;
  };
}

/**
 * Marks a module as global (its providers are available everywhere)
 *
 * @example
 * ```ts
 * \@Global()
 * \@Module({
 *   providers: [ConfigService],
 *   exports: [ConfigService],
 * })
 * class ConfigModule { }
 * ```
 */
export function Global(): Decorator<ClassDecoratorContext> {
  return (_: unknown, ctx: ClassDecoratorContext): void => {
    ctx.metadata[GLOBAL_MODULE_METADATA] = true;
  };
}

/**
 * Defines a module with imports, providers, and exports
 *
 * @example
 * ```ts
 * @Module({
 *   imports: [DatabaseModule],
 *   providers: [UserService, UserRepository],
 *   exports: [UserService],
 * })
 * class UserModule { }
 * ```
 */
export function Module(
  metadata: ModuleMetadata,
): Decorator<ClassDecoratorContext> {
  return (target: unknown, ctx: ClassDecoratorContext): void => {
    // modules are also "injectables", they could implement a lifecycle hook
    // and therefore we should apply the decorator as well.
    Injectable()(target, ctx);

    ctx.metadata[MODULE_METADATA] ??= metadata;
  };
}

/**
 * Registers searchable tags.
 *
 * @param {Tag[]} tags - The tags as rest arguments.
 *
 * @example
 * ```ts
 * \@Module({
 *   providers: [ConfigService]
 * })
 * \@Global()
 * export class ConfigModule {}
 *
 * ```
 */
export function Tags(...tags: Tag[]): Decorator<ClassDecoratorContext> {
  return (_: unknown, ctx: ClassDecoratorContext): void => {
    const existingTags = (ctx.metadata[TAG_METADATA] ?? []) as Tag[];

    ctx.metadata[TAG_METADATA] = [...new Set<Tag>([...existingTags, ...tags])];
  };
}
