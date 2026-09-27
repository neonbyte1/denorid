import type { InjectorContext, Type } from "@denorid/injector";
import { MESSAGE_CONTROLLER_METADATA } from "./_constants.ts";
import { Application, type ApplicationOptions } from "./application.ts";
import type { MicroserviceApplicationContext } from "./application_context.ts";
import type { CanActivate, CanActivateFn } from "./guards/can_activate.ts";
import type { MicroserviceServer } from "./microservices/server.ts";

/**
 * Application that serves a single {@link MicroserviceServer}. Created by
 * `DenoridFactory.create(module, server)`.
 */
export class MicroserviceApplication extends Application
  implements MicroserviceApplicationContext {
  /**
   * @param {Type} metaType - The root module class used to derive the logger name.
   * @param {InjectorContext} ctx - The injector context for resolving providers.
   * @param {ApplicationOptions} options - Options to configure the application.
   * @param {MicroserviceServer} server - The server transport to start.
   */
  public constructor(
    metaType: Type,
    ctx: InjectorContext,
    options: ApplicationOptions,
    private readonly server: MicroserviceServer,
  ) {
    super(metaType, ctx, options);
  }

  private readonly globalGuards: Set<CanActivate | CanActivateFn> = new Set();

  /**
   * Settles with the running {@link listen}. Cleared when it rejects, so a
   * later call starts the server again.
   */
  private listening?: Promise<void>;

  /**
   * @inheritdoc
   */
  public useGlobalGuards(...guards: (CanActivate | CanActivateFn)[]): void {
    for (const guard of guards) {
      this.globalGuards.add(guard);
    }
  }

  /**
   * Initializes the application (unless {@link init} already did), hands the
   * exception handler, the global guards and the message handlers to the
   * server and starts it. Concurrent and later calls share the same promise,
   * which resolves once the server accepts messages. When starting the server
   * fails, it is closed and the next call starts over. Nothing is started once
   * {@link close} was called.
   *
   * @returns {Promise<void>} Resolves when the server is ready.
   */
  public listen(): Promise<void> {
    if (this.closing) {
      return Promise.resolve();
    }

    this.listening ??= this.start().catch((error: unknown) => {
      this.listening = undefined;
      throw error;
    });

    return this.listening;
  }

  /**
   * @inheritdoc
   */
  protected override async shutdown(): Promise<void> {
    try {
      if (this.listening) {
        await this.server.close();
      }
    } finally {
      await super.shutdown();
    }
  }

  /**
   * Starts the server once the application is initialized.
   *
   * @returns {Promise<void>} Resolves when the server is ready.
   */
  private async start(): Promise<void> {
    await this.init();

    // `close()` may have been called while the application initialized.
    if (this.closing) {
      return;
    }

    this.server.setExceptionHandler(this.exceptionHandler);
    this.server.setGlobalGuards([...this.globalGuards]);
    this.server.registerHandlers(
      this.ctx.container.getTokensByTag(
        MESSAGE_CONTROLLER_METADATA,
        true,
      ) as Type[],
      this.ctx,
    );

    try {
      await this.server.listen();
    } catch (error) {
      // Release what the failed server holds before `listen()` is retried.
      await this.server.close().catch((): void => {});
      throw error;
    }
  }
}
