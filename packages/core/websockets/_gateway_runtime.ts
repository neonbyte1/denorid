import type { InjectorContext, Type } from "@denorid/injector";
import type { LoggerService } from "@denorid/logger";
import type { ZodType } from "zod";
import { WEBSOCKET_GATEWAY } from "../_constants.ts";
import type { ExceptionHandler } from "../exceptions/handler.ts";
import type { CanActivate, CanActivateFn } from "../guards/can_activate.ts";
import { getMethodGuards, GUARDS_METADATA } from "../guards/decorator.ts";
import { isClass, isFunction } from "../type_guards.ts";
import {
  getGatewayOptions,
  getMessageBodySchema,
  getSubscribeMessageMetadata,
  getWebSocketServerFields,
  type SubscribeMessageMetadata,
} from "./_metadata.ts";
import type { WebSocketAdapter, WsMessageHandler } from "./adapter.ts";
import { WsContext } from "./context.ts";
import { WsException } from "./exception.ts";
import { WsExecutionContext, WsHostArguments } from "./ws_host_arguments.ts";

type Guard = Type<CanActivate> | CanActivate | CanActivateFn;

type GatewayInstance = Record<PropertyKey, unknown>;

type GatewayMethod = (this: GatewayInstance, ctx: WsContext) => unknown;

/**
 * A `@SubscribeMessage()` method of a connected gateway.
 */
interface GatewayHandler {
  /** Subscribed event name. */
  event: string;
  /** The gateway method. */
  method: GatewayMethod;
  /** Schema of `@MessageBody()`, when the payload is validated. */
  schema: ZodType | undefined;
  /** Global, class and method guards, in evaluation order. */
  guards: Guard[];
}

/**
 * Dependencies of the {@link GatewayRuntime}.
 */
export interface GatewayRuntimeOptions {
  /** Injector context the gateways are resolved from. */
  ctx: InjectorContext;
  /** Handler of errors thrown while handling a message. */
  exceptionHandler: ExceptionHandler;
  /** Guards evaluated before the class and method guards of every method. */
  globalGuards: (CanActivate | CanActivateFn)[];
  /** Logger for errors of `handleConnection` and `handleDisconnect`. */
  logger: LoggerService;
}

/**
 * Connects `@WebSocketGateway()` classes to a {@link WebSocketAdapter} and
 * runs guards, validation and exception handling for their messages.
 */
export class GatewayRuntime {
  private adapter?: WebSocketAdapter;
  /** Every distinct server, with its events and the `Gateway.method()` handling each. */
  private readonly servers: Map<unknown, Map<string, string>> = new Map();

  /**
   * @param {GatewayRuntimeOptions} options - Runtime dependencies.
   */
  public constructor(private readonly options: GatewayRuntimeOptions) {}

  /**
   * Discovers all gateways and connects them to the adapter returned by
   * `getAdapter`. Does nothing, and does not call `getAdapter`, when the
   * application has no gateway.
   *
   * @param {() => WebSocketAdapter | undefined} getAdapter - Returns the
   *   adapter to use.
   * @return {Promise<void>} Resolves once every gateway is connected.
   * @throws {Error} When `getAdapter` returns no adapter, an event is handled
   *   by two methods of one gateway or of gateways sharing a server, or
   *   `afterInit` fails.
   */
  public async connect(
    getAdapter: () => WebSocketAdapter | undefined,
  ): Promise<void> {
    const gateways = this.options.ctx.container.getTokensByTag(
      WEBSOCKET_GATEWAY,
      true,
    ) as Type[];

    if (gateways.length === 0) {
      return;
    }

    const adapter = getAdapter();

    if (!adapter) {
      throw new Error(
        `No WebSocket adapter available for ${
          gateways.map(({ name }: Type): string => name).join(", ")
        }. Call app.useWebSocketAdapter() or use an HTTP adapter that ` +
          "implements createWebSocketAdapter().",
      );
    }

    this.adapter = adapter;

    for (const gateway of gateways) {
      await this.connectGateway(adapter, gateway);
    }
  }

  /**
   * Closes every server created by {@link connect} once. Errors are logged.
   *
   * @return {Promise<void>} Resolves once every server is closed.
   */
  public async close(): Promise<void> {
    const servers = [...this.servers.keys()];

    this.servers.clear();

    await Promise.all(
      servers.map((server: unknown): Promise<void> =>
        this.adapter!.close(server).catch((error: unknown): void => {
          this.options.logger.error(
            "Failed to close a WebSocket server",
            error,
          );
        })
      ),
    );
  }

  private async connectGateway(
    adapter: WebSocketAdapter,
    gateway: Type,
  ): Promise<void> {
    const subscriptions = getSubscribeMessageMetadata(gateway);
    const methods = new Map<string, string | symbol>();

    for (const { event, name } of subscriptions) {
      const existing = methods.get(event);

      if (existing !== undefined) {
        throw new Error(
          `${gateway.name} subscribes to the event "${event}" in both ` +
            `${String(existing)}() and ${String(name)}(). ` +
            "An event can be handled by one method per gateway only.",
        );
      }

      methods.set(event, name);
    }

    const instance = await this.options.ctx.getHostModuleRef().get(
      gateway as Type<GatewayInstance>,
      { strict: false },
    );
    const classGuards = [
      ...(gateway[Symbol.metadata]?.[GUARDS_METADATA] as
        | Set<Guard>
        | undefined ?? []),
    ];
    const handlers = subscriptions.map((
      { event, name }: SubscribeMessageMetadata,
    ): GatewayHandler => ({
      event,
      method: instance[name] as GatewayMethod,
      schema: getMessageBodySchema(gateway, name),
      guards: [
        ...this.options.globalGuards,
        ...classGuards,
        ...(getMethodGuards(gateway, name) ?? []),
      ],
    }));

    const server = await adapter.create(getGatewayOptions(gateway));
    let events = this.servers.get(server);

    if (!events) {
      events = new Map();
      this.servers.set(server, events);
    }

    // Gateways sharing a server bind their handlers to the same clients, so
    // an event must be unique per server, not only per gateway.
    for (const { event, name } of subscriptions) {
      const owner = events.get(event);
      const method = `${gateway.name}.${String(name)}()`;

      if (owner !== undefined) {
        throw new Error(
          `${method} subscribes to the event "${event}", which ${owner} ` +
            "already handles on the same WebSocket server. Gateways with " +
            "equal options share a server, and an event can be handled by " +
            "one method per server only.",
        );
      }

      events.set(event, method);
    }

    for (const field of getWebSocketServerFields(gateway)) {
      instance[field] = server;
    }

    if (isFunction<(server: unknown) => unknown>(instance.afterInit)) {
      await instance.afterInit(server);
    }

    adapter.bindClientConnect(
      server,
      (client: unknown, ...args: unknown[]): void => {
        adapter.bindMessageHandlers(
          client,
          handlers.map((handler: GatewayHandler): WsMessageHandler => ({
            event: handler.event,
            callback: (data: unknown): Promise<unknown> =>
              this.dispatch(gateway, instance, handler, client, data),
          })),
        );
        adapter.bindClientDisconnect(client, (): void => {
          this.invokeHook(gateway, instance, "handleDisconnect", [client]);
        });
        this.invokeHook(gateway, instance, "handleConnection", [
          client,
          ...args,
        ]);
      },
    );
  }

  private dispatch(
    gateway: Type,
    instance: GatewayInstance,
    handler: GatewayHandler,
    client: unknown,
    data: unknown,
  ): Promise<unknown> {
    const { ctx, exceptionHandler } = this.options;
    const contextId = crypto.randomUUID();

    return ctx.runInRequestScopeAsync(contextId, async (): Promise<unknown> => {
      try {
        await this.canActivate(gateway, handler, client, data, contextId);

        return await handler.method.call(
          instance,
          new WsContext(
            contextId,
            handler.event,
            this.validate(handler, data),
            client,
          ),
        );
      } catch (error) {
        const result = await exceptionHandler.handle(
          error,
          new WsHostArguments(handler.event, data, client),
        );

        if (exceptionHandler.canHandle(error)) {
          return result;
        }

        throw error instanceof WsException
          ? error
          : new WsException("Internal server error");
      } finally {
        ctx.clearContext(contextId);
      }
    });
  }

  private async canActivate(
    gateway: Type,
    handler: GatewayHandler,
    client: unknown,
    data: unknown,
    contextId: string,
  ): Promise<void> {
    if (handler.guards.length === 0) {
      return;
    }

    const executionContext = new WsExecutionContext(
      handler.event,
      data,
      client,
      gateway,
      handler.method,
    );

    for (const guard of handler.guards) {
      let allowed: boolean;

      if (isClass<CanActivate>(guard)) {
        allowed = await (await this.options.ctx.getHostModuleRef().get(guard, {
          contextId,
          strict: false,
        })).canActivate(executionContext);
      } else if (isFunction<CanActivateFn>(guard)) {
        allowed = await guard(executionContext);
      } else {
        allowed = await guard.canActivate(executionContext);
      }

      if (!allowed) {
        throw new WsException("Forbidden resource");
      }
    }
  }

  private validate(handler: GatewayHandler, data: unknown): unknown {
    if (!handler.schema) {
      return data;
    }

    const result = handler.schema.safeParse(data);

    if (!result.success) {
      throw new WsException({
        status: "error",
        message: result.error.issues.map(({ message }: { message: string }) =>
          message
        ),
      });
    }

    return result.data;
  }

  private invokeHook(
    gateway: Type,
    instance: GatewayInstance,
    hook: "handleConnection" | "handleDisconnect",
    args: unknown[],
  ): void {
    const fn = instance[hook];

    if (!isFunction<(...hookArgs: unknown[]) => unknown>(fn)) {
      return;
    }

    const logError = (error: unknown): void => {
      this.options.logger.error(`${gateway.name}.${hook}() failed`, error);
    };

    try {
      Promise.resolve(fn.apply(instance, args)).catch(logError);
    } catch (error) {
      logError(error);
    }
  }
}
