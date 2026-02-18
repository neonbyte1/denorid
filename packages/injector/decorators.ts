import {
  GLOBAL_MODULE_METADATA,
  INJECTABLE_METADATA,
  type InjectableMetadata,
  INJECTION_METADATA,
  type InjectionDependency,
  MODULE_METADATA,
  TAG_METADATA,
} from "./_metadata.ts";
import type {
  InjectableOptions,
  InjectionToken,
  InjectOptions,
  Tag,
  Type,
} from "./common.ts";
import type { ModuleMetadata } from "./modules.ts";

/**
 * Marks a class field for dependency injection.
 *
 * @param {InjectionToken} token The token that will be resolved and injected into the field.
 * @param {string|undefined} options Foo
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
export function Inject(token: InjectionToken, options?: InjectOptions) {
  return (_: unknown, ctx: ClassFieldDecoratorContext): void => {
    if (ctx.static) {
      throw new Error("@Inject cannot be used on static fields");
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

    dependencies.push({ field: ctx.name, token, options });
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
export function Injectable(options?: InjectableOptions) {
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
export function Global() {
  return (_: Type, ctx: ClassDecoratorContext): void => {
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
export function Module(metadata: ModuleMetadata) {
  return (target: Type, ctx: ClassDecoratorContext): void => {
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
export function Tags(...tags: Tag[]) {
  return (_: Type, ctx: ClassDecoratorContext): void => {
    const existingTags = (ctx.metadata[TAG_METADATA] ?? []) as Tag[];

    ctx.metadata[TAG_METADATA] = [...new Set<Tag>([...existingTags, ...tags])];
  };
}
