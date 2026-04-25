import type { InjectorContext, Type } from "@denorid/injector";
import { MESSAGE_CONTROLLER_METADATA } from "./_constants.ts";
import { Application, type ApplicationOptions } from "./application.ts";
import type { MicroserviceApplicationContext } from "./application_context.ts";
import type { CanActivate, CanActivateFn } from "./guards/can_activate.ts";
import type { MicroserviceServer } from "./microservices/server.ts";

export class MicroserviceApplication extends Application
  implements MicroserviceApplicationContext {
  public constructor(
    metaType: Type,
    ctx: InjectorContext,
    options: ApplicationOptions,
    private readonly server: MicroserviceServer,
  ) {
    super(metaType, ctx, options);
  }

  private readonly globalGuards: Set<CanActivate | CanActivateFn> = new Set();

  public useGlobalGuards(...guards: (CanActivate | CanActivateFn)[]): void {
    for (const guard of guards) {
      this.globalGuards.add(guard);
    }
  }

  public async listen(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.init();
    await this.exceptionHandler.register();
    this.server.setExceptionHandler(this.exceptionHandler);
    this.server.setGlobalGuards([...this.globalGuards]);
    this.discoverHandlers();
    await this.server.listen();
  }

  public override async close(): Promise<void> {
    if (this.initialized) {
      await this.server.close();
      await super.close();
    }
  }

  private discoverHandlers(): void {
    const tokens = this.ctx.container.getTokensByTag(
      MESSAGE_CONTROLLER_METADATA,
    );
    this.server.registerHandlers(tokens as Type[], this.ctx);
  }
}
