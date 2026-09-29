<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  A versatile logger designed for both standalone use and integration with <a href="https://github.com/neonbyte1/denorid">Denorid</a> applications.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid/logger">
    <img src="https://jsr.io/badges/@denorid/logger" alt="Denorid logger version" />
  </a>
</p>

## Installation

```bash
deno add jsr:@denorid/logger
```

## Quick Start

```ts
import { Logger } from "@denorid/logger";

const logger = new Logger("AppModule");

logger.log("Application started");
logger.warn("Low memory");
logger.error("Something went wrong");
```

## Custom Logger

`Logger.overrideLogger()` installs a `LoggerService` (or a configured `Logger`)
for the whole application: static `Logger.*` calls and every `Logger` instance,
including Denorid's internal ones, write through it. Instances still apply their
own `levels` and add their context label.

```ts
import { Logger } from "@denorid/logger";

Logger.overrideLogger(new Logger({ json: true }));

new Logger("AppModule").log("Application started");
// {"level":"log","pid":1234,"timestamp":1790640000000,"context":"AppModule","message":"Application started"}
```

## License

The [@denorid/logger](https://github.com/neonbyte1/denorid) package is
[MIT licensed](../../LICENSE.md).
