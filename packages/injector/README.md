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

## License

The [@denorid/injector](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
