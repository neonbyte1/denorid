import type { InjectorContext, Type } from "@denorid/injector";
import { Application, type ApplicationOptions } from "./application.ts";
import type { MicroserviceApplicationContext } from "./application_context.ts";
import type { CanActivate, CanActivateFn } from "./guards/can_activate.ts";
import { MESSAGE_CONTROLLER_METADATA } from "./_constants.ts";
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
    await this.discoverHandlers();
    await this.server.listen();
  }

  public override async close(): Promise<void> {
    if (this.initialized) {
      await this.server.close();
      await super.close();
    }
  }

  private async discoverHandlers(): Promise<void> {
    const tokens = this.ctx.container.getTokensByTag(
      MESSAGE_CONTROLLER_METADATA,
    );
    const types: Type[] = [];
    const instances: unknown[] = [];

    for (const token of tokens) {
      const instance = await this.ctx.resolveInternal(token);
      types.push(token as Type);
      instances.push(instance);
    }

    this.server.registerHandlers(types, instances);
  }
}
