<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  A powerful, type-safe dependency injection framework inspired by <a href="https://nestjs.com/">NestJS</a>.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/injector">
    <img src="https://jsr.io/badges/@denorid/injector" alt="Denorid Injector version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/injector
```

## Quick Start

```ts
import {
  Inject,
  Injectable,
  InjectorContext,
  Module,
} from "jsr:@denorid/injector";

// Define a service
@Injectable()
class Logger {
  log(message: string) {
    console.log(`[LOG] ${message}`);
  }
}

// Define a service with dependencies
@Injectable()
class UserService {
  @Inject(Logger)
  private logger!: Logger;

  createUser(name: string) {
    this.logger.log(`Creating user: ${name}`);
    return { id: crypto.randomUUID(), name };
  }
}

// Define a module
@Module({
  providers: [Logger, UserService],
  exports: [UserService],
})
class AppModule {}

// Bootstrap the application
const ctx = await InjectorContext.create(AppModule);
await ctx.onApplicationBootstrap();

// Resolve and use services
const userService = await ctx.resolve(UserService);
const user = userService.createUser("Alice");

// Cleanup
await ctx.close();
```

## Behavior

- **Modes**: `singleton` (default) is created once per registration and receives
  lifecycle hooks and disposal. `transient` is created on every resolution (once
  per `contextId` with `resolveWithinContext` until
  `ctx.clearContext(contextId)`), `request` once per request
  (`runInRequestScope*`). Transient and request-scoped instances belong to their
  consumer: no lifecycle hooks, no disposal.
- **Scope bubbling**: a provider that depends on a request-scoped provider
  (`@Inject` fields, inherited ones included, factory `inject` tokens or an
  alias target, transitively) is request-scoped itself, whatever mode it
  declares. A singleton controller injecting request state therefore gets a
  fresh instance per request instead of keeping the first request's state.
  `isRequestScoped` / `getProviderMode` report this effective mode, and such
  providers are skipped during init and get no lifecycle hooks.
- **Concurrency**: concurrent resolutions share one singleton (or one
  request-scoped / context-cached instance); a failed resolution is retried by
  the next call. Circular dependencies reject with `CircularDependencyError`,
  also across concurrent resolutions.
- **Aliases**: `{ provide, useExisting }` resolves its target on every call and
  keeps the target's mode.
- **Global modules**: a `@Global()` module's providers exist once, whether a
  module imports the global module or not.
- **Lifecycle order**: `onApplicationBootstrap` runs dependencies first;
  `onBeforeApplicationShutdown`, `onModuleDestroy`, `onApplicationShutdown` and
  disposal (`Symbol.asyncDispose` / `Symbol.dispose` of class and factory
  providers) run consumers first. `ctx.close()` (or `await using`) runs the
  whole shutdown once and clears every container.
- **Visibility**: `ctx.resolve` only sees tokens exported by the root module
  (plus globals). `ctx.resolveInternal(token)` and
  `moduleRef.get(token, { strict: false })` resolve through the root module when
  the token is visible there, otherwise from the module that declares it.
- **Errors**: promise-returning methods reject instead of throwing
  synchronously; `tryResolve` returns `undefined` only for a missing token and
  rethrows other errors.
- **Inheritance**: a subclass decorated with `@Injectable(...)` gets its own
  options; `@Inject` fields of the parent are inherited and may be redeclared.

## License

The [@denorid/injector](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
