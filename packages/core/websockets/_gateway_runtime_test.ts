import {
  Global,
  Injectable,
  InjectorContext,
  Module,
  type Type,
} from "@denorid/injector";
import { Logger, type LoggerService } from "@denorid/logger";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { describe, it } from "node:test";
import { z } from "zod";
import { Catch, type ExceptionFilter } from "../exceptions/filter.ts";
import { ExceptionHandler } from "../exceptions/handler.ts";
import type { CanActivate } from "../guards/can_activate.ts";
import { UseGuards } from "../guards/decorator.ts";
import type { ExecutionContext } from "../guards/execution_context.ts";
import type { HostArguments } from "../host_arguments.ts";
import type { HttpAdapter } from "../http/adapter.ts";
import type { ControllerMapping } from "../http/controller_mapping.ts";
import { HttpApplication } from "../http_application.ts";
import type { MicroserviceServer } from "../microservices/server.ts";
import { GatewayRuntime } from "./_gateway_runtime.ts";
import {
  FakeClient,
  type FakeServer,
  FakeWebSocketAdapter,
} from "./_test_utils.ts";
import type { WebSocketAdapter } from "./adapter.ts";
import type { WsContext } from "./context.ts";
import { WsException } from "./exception.ts";
import { WebSocketGateway } from "./gateway.ts";
import type {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from "./interfaces.ts";
import { MessageBody } from "./message_body.ts";
import { SubscribeMessage } from "./subscribe_message.ts";
import { WebSocketServer } from "./web_socket_server.ts";
import { WsExecutionContext, WsHostArguments } from "./ws_host_arguments.ts";

class RecordingLogger implements LoggerService {
  public readonly errors: unknown[][] = [];

  public log(): void {}

  public warn(): void {}

  public fatal(): void {}

  public error(...args: unknown[]): void {
    this.errors.push(args);
  }
}

interface Harness extends AsyncDisposable {
  app: HttpApplication;
  ctx: InjectorContext;
  adapter: FakeWebSocketAdapter;
  httpAdapter: HttpAdapter;
  logger: RecordingLogger;
  exceptionHandler: ExceptionHandler;
}

interface HarnessOptions {
  httpAdapter?: HttpAdapter;
  useAdapter?: boolean;
  imports?: Type[];
}

function makeHttpAdapter(): HttpAdapter {
  return {
    listen: () => {},
    close: () => Promise.resolve(),
    createControllerMapping: () =>
      Promise.resolve({
        register: () => Promise.resolve(),
      } as unknown as ControllerMapping),
  };
}

async function createApp(
  providers: Type[],
  options: HarnessOptions = {},
): Promise<Harness> {
  @Module({ imports: options.imports, providers })
  class AppModule {}

  let exceptionHandler!: ExceptionHandler;
  using _log = stub(Logger.prototype, "log");
  const ctx = await InjectorContext.create(AppModule, {
    useGlobals: true,
    beforeInit: (ctx: InjectorContext): void => {
      exceptionHandler = new ExceptionHandler(ctx);
      ctx.registerGlobal({
        provide: ExceptionHandler,
        useValue: exceptionHandler,
      });
    },
  });
  const httpAdapter = options.httpAdapter ?? makeHttpAdapter();
  const logger = new RecordingLogger();
  const app = new HttpApplication(AppModule, ctx, {
    adapter: httpAdapter,
    logger,
  });
  const adapter = new FakeWebSocketAdapter();

  if (options.useAdapter ?? true) {
    app.useWebSocketAdapter(adapter);
  }

  return {
    app,
    ctx,
    adapter,
    httpAdapter,
    logger,
    exceptionHandler,
    [Symbol.asyncDispose]: () => app.close(),
  };
}

function connect(h: Harness, path: string = "/"): FakeClient {
  const client = new FakeClient(crypto.randomUUID());

  h.adapter.connect(path, client);

  return client;
}

describe("WebSocket gateways", () => {
  describe("setup", () => {
    it("creates a server per gateway, injects it and calls afterInit", async () => {
      const initialized: unknown[] = [];

      @WebSocketGateway({ path: "/chat", namespace: "rooms" })
      class ChatGateway implements OnGatewayInit<FakeServer> {
        @WebSocketServer()
        public server!: FakeServer;

        @WebSocketServer()
        public alias!: FakeServer;

        public async afterInit(server: FakeServer): Promise<void> {
          await Promise.resolve();
          initialized.push(server, this.server);
        }
      }

      await using h = await createApp([ChatGateway]);
      await h.app.init();

      const server = h.adapter.servers.get("/chat")!;
      const gateway = await h.app.get(ChatGateway);

      assertEquals(server.options, { path: "/chat", namespace: "rooms" });
      assertStrictEquals(gateway.server, server);
      assertStrictEquals(gateway.alias, server);
      assertEquals(initialized, [server, server]);
    });

    it("shares servers of equal paths and closes every server once, after microservices and before the HTTP adapter", async () => {
      @WebSocketGateway({ path: "/a" })
      class FirstGateway {}

      @WebSocketGateway({ path: "/a" })
      class SecondGateway {}

      @WebSocketGateway()
      class RootGateway {}

      const h = await createApp([FirstGateway, SecondGateway, RootGateway]);
      const order: string[] = [];

      using _ws = stub(h.adapter, "close", (server: FakeServer) => {
        order.push(`ws:${server.options.path ?? "/"}`);
        return Promise.resolve();
      });
      using _http = stub(h.httpAdapter, "close", () => {
        order.push("http");
        return Promise.resolve();
      });
      h.app.connectMicroservice({
        close: (): Promise<void> => {
          order.push("microservice");
          return Promise.resolve();
        },
      } as unknown as MicroserviceServer);

      await h.app.init();

      assertEquals([...h.adapter.servers.keys()], ["/a", "/"]);

      await h.app.close();

      assertEquals(order, ["microservice", "ws:/a", "ws:/", "http"]);
    });

    it("logs failures of adapter.close() and still closes the HTTP adapter", async () => {
      @WebSocketGateway()
      class Gateway {}

      const h = await createApp([Gateway]);
      const error = new Error("close failed");

      using _ws = stub(h.adapter, "close", () => Promise.reject(error));
      using httpClose = spy(h.httpAdapter, "close");

      await h.app.init();
      await h.app.close();

      assertEquals(h.logger.errors, [[
        "Failed to close a WebSocket server",
        error,
      ]]);
      assertSpyCalls(httpClose, 1);
    });

    it("fails init when afterInit rejects", async () => {
      @WebSocketGateway()
      class Gateway implements OnGatewayInit {
        public afterInit(): Promise<void> {
          return Promise.reject(new Error("afterInit failed"));
        }
      }

      await using h = await createApp([Gateway]);

      await assertRejects(() => h.app.init(), Error, "afterInit failed");
    });

    it("fails init when two methods subscribe the same event", async () => {
      @WebSocketGateway()
      class DuplicateGateway {
        @SubscribeMessage("ping")
        public first(): void {}

        @SubscribeMessage("ping")
        public second(): void {}
      }

      await using h = await createApp([DuplicateGateway]);

      await assertRejects(
        () => h.app.init(),
        Error,
        'DuplicateGateway subscribes to the event "ping" in both first() and second().',
      );
      assertEquals(h.adapter.servers.size, 0);
    });

    it("fails init when gateways sharing a server subscribe the same event", async () => {
      @WebSocketGateway({ path: "/lobby" })
      class LobbyGateway {
        @SubscribeMessage("join")
        public join(): void {}
      }

      @WebSocketGateway({ path: "/rooms" })
      class RoomsGateway {
        @SubscribeMessage("join")
        public join(): void {}
      }

      @WebSocketGateway({ path: "/rooms" })
      class ChatGateway {
        @SubscribeMessage("message")
        @SubscribeMessage("join")
        public enter(): void {}
      }

      const h = await createApp([LobbyGateway, RoomsGateway, ChatGateway]);

      await assertRejects(
        () => h.app.init(),
        Error,
        'ChatGateway.enter() subscribes to the event "join", which RoomsGateway.join() already handles on the same WebSocket server.',
      );

      await h.app.close();

      assertEquals(
        h.adapter.closed.map(({ options }) => options.path),
        ["/lobby", "/rooms"],
      );
    });

    it("connects a gateway of a @Global() module once", async () => {
      const calls: string[] = [];

      @WebSocketGateway({ path: "/global" })
      class GlobalGateway implements OnGatewayInit, OnGatewayConnection {
        @SubscribeMessage("ping")
        public ping(): string {
          return "pong";
        }

        public afterInit(): void {
          calls.push("init");
        }

        public handleConnection(): void {
          calls.push("connect");
        }
      }

      @Global()
      @Module({ providers: [GlobalGateway], exports: [GlobalGateway] })
      class GlobalModule {}

      await using h = await createApp([], { imports: [GlobalModule] });
      await h.app.init();

      const client = connect(h, "/global");

      assertEquals(calls, ["init", "connect"]);
      assertEquals(client.handlers.map(({ event }) => event), ["ping"]);
    });

    it("connects a gateway of a nested module that does not export it", async () => {
      @WebSocketGateway({ path: "/nested" })
      class NestedGateway {
        @SubscribeMessage("ping")
        public ping(): string {
          return "pong";
        }
      }

      @Module({ providers: [NestedGateway] })
      class ChatModule {}

      @Module({ imports: [ChatModule] })
      class FeatureModule {}

      await using h = await createApp([], { imports: [FeatureModule] });
      await h.app.init();

      assertEquals(await connect(h, "/nested").send("ping", null), "pong");
    });

    it("fails init without a WebSocket adapter", async () => {
      @WebSocketGateway()
      class FirstGateway {}

      @WebSocketGateway()
      class SecondGateway {}

      await using h = await createApp([FirstGateway, SecondGateway], {
        useAdapter: false,
      });

      await assertRejects(
        () => h.app.init(),
        Error,
        "No WebSocket adapter available for FirstGateway, SecondGateway.",
      );
    });

    it("uses the default WebSocket adapter of the HTTP adapter", async () => {
      @WebSocketGateway()
      class Gateway {}

      const adapter = new FakeWebSocketAdapter();
      const httpAdapter: HttpAdapter = {
        ...makeHttpAdapter(),
        createWebSocketAdapter: (): WebSocketAdapter => adapter,
      };

      await using h = await createApp([Gateway], {
        httpAdapter,
        useAdapter: false,
      });
      await h.app.init();

      assertEquals([...adapter.servers.keys()], ["/"]);
    });

    it("prefers the adapter passed to useWebSocketAdapter()", async () => {
      @WebSocketGateway()
      class Gateway {}

      const httpAdapter: HttpAdapter = {
        ...makeHttpAdapter(),
        createWebSocketAdapter: (): WebSocketAdapter =>
          new FakeWebSocketAdapter(),
      };
      using createDefault = spy(httpAdapter, "createWebSocketAdapter");

      await using h = await createApp([Gateway], { httpAdapter });
      await h.app.init();

      assertSpyCalls(createDefault, 0);
      assertEquals([...h.adapter.servers.keys()], ["/"]);
    });

    it("does not create a WebSocket adapter without gateways", async () => {
      const httpAdapter: HttpAdapter = {
        ...makeHttpAdapter(),
        createWebSocketAdapter: (): WebSocketAdapter =>
          new FakeWebSocketAdapter(),
      };
      using createDefault = spy(httpAdapter, "createWebSocketAdapter");

      await using h = await createApp([], { httpAdapter, useAdapter: false });
      await h.app.init();

      assertSpyCalls(createDefault, 0);
    });

    it("connects gateways without decorator metadata", async () => {
      class PlainGateway {}

      Object.defineProperty(PlainGateway, Symbol.metadata, { value: null });

      const adapter = new FakeWebSocketAdapter();
      const ctx = {
        container: { getTokensByTag: () => [PlainGateway] },
        getHostModuleRef: () => ({
          get: () => Promise.resolve(new PlainGateway()),
        }),
      } as unknown as InjectorContext;
      const runtime = new GatewayRuntime({
        ctx,
        exceptionHandler: new ExceptionHandler(ctx),
        globalGuards: [],
        logger: new RecordingLogger(),
      });

      await runtime.connect(() => adapter);

      const client = new FakeClient("1");

      adapter.connect("/", client);
      adapter.disconnect(client);

      assertEquals(adapter.servers.get("/")!.options, {});
      assertEquals(client.handlers, []);

      await runtime.close();

      assertEquals(adapter.closed.length, 1);
    });
  });

  describe("connections", () => {
    it("binds the handlers and calls the connection hooks", async () => {
      const calls: unknown[][] = [];

      @WebSocketGateway()
      class Gateway
        implements
          OnGatewayConnection<FakeClient>,
          OnGatewayDisconnect<FakeClient> {
        @SubscribeMessage("a")
        public a(): string {
          return "a";
        }

        @SubscribeMessage("b")
        public b(): string {
          return "b";
        }

        public handleConnection(client: FakeClient, ...args: unknown[]): void {
          calls.push(["connect", client.handlers.length, client.id, ...args]);
        }

        public handleDisconnect(client: FakeClient): void {
          calls.push(["disconnect", client.id]);
        }
      }

      await using h = await createApp([Gateway]);
      await h.app.init();

      const client = new FakeClient("c1");

      h.adapter.connect("/", client, "request", 42);

      assertEquals(client.handlers.map(({ event }) => event), ["a", "b"]);
      assertEquals(calls, [["connect", 2, "c1", "request", 42]]);

      h.adapter.disconnect(client);

      assertEquals(calls[1], ["disconnect", "c1"]);
    });

    it("logs errors of the connection hooks instead of throwing them", async () => {
      const connectError = new Error("connect failed");
      const disconnectError = new Error("disconnect failed");

      @WebSocketGateway()
      class HookGateway implements OnGatewayConnection, OnGatewayDisconnect {
        public handleConnection(): void {
          throw connectError;
        }

        public handleDisconnect(): Promise<void> {
          return Promise.reject(disconnectError);
        }
      }

      await using h = await createApp([HookGateway]);
      await h.app.init();

      const client = connect(h);

      h.adapter.disconnect(client);
      await Promise.resolve();

      assertEquals(h.logger.errors, [
        ["HookGateway.handleConnection() failed", connectError],
        ["HookGateway.handleDisconnect() failed", disconnectError],
      ]);
    });

    it("connects and disconnects clients of gateways without hooks", async () => {
      @WebSocketGateway()
      class Gateway {}

      await using h = await createApp([Gateway]);
      await h.app.init();

      const client = connect(h);

      h.adapter.disconnect(client);

      assertEquals(client.disconnectCallbacks.length, 1);
      assertEquals(h.logger.errors, []);
    });
  });

  describe("messages", () => {
    it("calls the method with a WsContext inside a request scope", async () => {
      const received: [unknown, WsContext][] = [];

      @WebSocketGateway()
      class Gateway {
        @SubscribeMessage("echo")
        public echo(ctx: WsContext<unknown, FakeClient>): unknown {
          received.push([this, ctx]);
          return { echoed: ctx.data };
        }
      }

      await using h = await createApp([Gateway]);
      await h.app.init();

      using clearContext = spy(h.ctx, "clearContext");
      const client = connect(h);
      const result = await client.send("echo", { text: "hi" });
      const [[self, ctx]] = received;

      assertEquals(result, { echoed: { text: "hi" } });
      assertStrictEquals(self, await h.app.get(Gateway));
      assertEquals(ctx.event, "echo");
      assertEquals(ctx.data, { text: "hi" });
      assertStrictEquals(ctx.client, client);
      assertSpyCalls(clearContext, 1);
      assertEquals(clearContext.calls[0].args, [ctx.contextId]);

      await client.send("echo", null);

      assertNotStrictEquals(received[1][1].contextId, ctx.contextId);
    });
  });

  describe("guards", () => {
    it("evaluates global, class and method guards in order", async () => {
      const order: string[] = [];
      const contexts: ExecutionContext[] = [];

      @Injectable({ mode: "transient" })
      class ClassGuard implements CanActivate {
        public readonly id: string = crypto.randomUUID();

        public canActivate(context: ExecutionContext): boolean {
          order.push(`class:${this.id}`);
          contexts.push(context);
          return true;
        }
      }

      const methodGuard: CanActivate = {
        canActivate: (): Promise<boolean> => {
          order.push("method");
          return Promise.resolve(true);
        },
      };

      @UseGuards(ClassGuard)
      @WebSocketGateway()
      class Gateway {
        @SubscribeMessage("guarded")
        @UseGuards(methodGuard)
        public guarded(): string {
          order.push("handler");
          return "ok";
        }
      }

      await using h = await createApp([ClassGuard, Gateway]);

      h.app.useGlobalGuards((): boolean => {
        order.push("global");
        return true;
      });
      await h.app.init();

      const client = connect(h);

      assertEquals(await client.send("guarded", { id: 1 }), "ok");
      assertEquals(await client.send("guarded", { id: 2 }), "ok");

      const [, first, , , , second] = order;

      assertEquals(order.map((entry) => entry.split(":")[0]), [
        "global",
        "class",
        "method",
        "handler",
        "global",
        "class",
        "method",
        "handler",
      ]);
      assertNotStrictEquals(first, second);

      const [context] = contexts;
      const gateway = await h.app.get(Gateway);

      assertInstanceOf(context, WsExecutionContext);
      assertStrictEquals(context.getClass(), Gateway);
      assertStrictEquals(context.getHandler(), gateway.guarded);
      assertStrictEquals(context.switchToWs().getClient(), client);
      assertEquals(context.switchToWs().getData(), { id: 1 });
      assertEquals(context.switchToWs().getPattern(), "guarded");
    });

    it("resolves class guards provided by any module, exported or not", async () => {
      @Injectable()
      class ExportedGuard implements CanActivate {
        public canActivate(): boolean {
          return true;
        }
      }

      @Injectable()
      class InternalGuard implements CanActivate {
        public canActivate(): boolean {
          return true;
        }
      }

      @Module({ providers: [InternalGuard] })
      class InternalModule {}

      @Module({
        imports: [InternalModule],
        providers: [ExportedGuard],
        exports: [ExportedGuard],
      })
      class GuardsModule {}

      @UseGuards(ExportedGuard, InternalGuard)
      @WebSocketGateway()
      class Gateway {
        @SubscribeMessage("guarded")
        public guarded(): string {
          return "ok";
        }
      }

      await using h = await createApp([Gateway], { imports: [GuardsModule] });
      await h.app.init();

      assertEquals(await connect(h).send("guarded", null), "ok");
    });

    it("rejects with a WsException when a guard denies", async () => {
      const handler = spy((): void => {});

      @WebSocketGateway()
      class Gateway {
        @SubscribeMessage("denied")
        public denied(): void {
          handler();
        }
      }

      await using h = await createApp([Gateway]);

      h.app.useGlobalGuards((): boolean => false);
      await h.app.init();

      const error = await assertRejects(
        () => connect(h).send("denied", null),
        WsException,
      );

      assertEquals(error.getPayload(), {
        status: "error",
        message: "Forbidden resource",
      });
      assertSpyCalls(handler, 0);
    });
  });

  describe("validation", () => {
    const schema = z.object({ text: z.string().trim(), count: z.number() });

    function createGateway(received: unknown[]): Type {
      @WebSocketGateway()
      class Gateway {
        @SubscribeMessage("message")
        @MessageBody(schema)
        public onMessage(ctx: WsContext<typeof schema>): number {
          received.push(ctx.data);
          return ctx.data.count;
        }
      }

      return Gateway;
    }

    it("passes the parsed payload to the method", async () => {
      const received: unknown[] = [];

      await using h = await createApp([createGateway(received)]);
      await h.app.init();

      const result = await connect(h).send("message", {
        text: "  hi  ",
        count: 2,
        extra: true,
      });

      assertEquals(result, 2);
      assertEquals(received, [{ text: "hi", count: 2 }]);
    });

    it("rejects invalid payloads with the validation messages", async () => {
      const received: unknown[] = [];

      await using h = await createApp([createGateway(received)]);
      await h.app.init();

      const error = await assertRejects(
        () => connect(h).send("message", { text: 1 }),
        WsException,
      );
      const payload = error.getPayload();

      assertEquals(payload.status, "error");
      assertEquals((payload.message as string[]).length, 2);
      assertEquals(received, []);
    });
  });

  describe("exceptions", () => {
    class RoomFullError extends Error {}

    it("resolves with the result of a matching exception filter", async () => {
      const hosts: HostArguments[] = [];

      @Catch(RoomFullError)
      class RoomFullFilter implements ExceptionFilter<RoomFullError> {
        public catch(_: RoomFullError, host: HostArguments): unknown {
          hosts.push(host);
          return { event: "full", data: host.switchToWs().getData() };
        }
      }

      @WebSocketGateway()
      class Gateway {
        @SubscribeMessage("join")
        public join(): void {
          throw new RoomFullError("full");
        }
      }

      await using h = await createApp([RoomFullFilter, Gateway]);
      await h.app.init();

      using _log = stub(h.exceptionHandler["logger"], "error");
      const client = connect(h);

      assertEquals(await client.send("join", "lobby"), {
        event: "full",
        data: "lobby",
      });
      assertInstanceOf(hosts[0], WsHostArguments);
      assertStrictEquals(hosts[0].switchToWs().getClient(), client);
      assertEquals(hosts[0].switchToWs().getPattern(), "join");
    });

    it("rejects with the WsException when no filter handles it", async () => {
      const thrown = new WsException({ code: "ROOM_FULL" });

      @WebSocketGateway()
      class Gateway {
        @SubscribeMessage("join")
        public join(): Promise<void> {
          return Promise.reject(thrown);
        }
      }

      await using h = await createApp([Gateway]);
      await h.app.init();

      using handle = spy(h.exceptionHandler, "handle");
      const error = await assertRejects(() => connect(h).send("join", null));

      assertStrictEquals(error, thrown);
      assertSpyCalls(handle, 1);
    });

    it("rejects with Internal server error for other errors and logs them", async () => {
      @WebSocketGateway()
      class Gateway {
        @SubscribeMessage("join")
        public join(): void {
          throw new Error("database down");
        }
      }

      await using h = await createApp([Gateway]);
      await h.app.init();

      using log = stub(h.exceptionHandler["logger"], "error");
      const error = await assertRejects(
        () => connect(h).send("join", null),
        WsException,
      );

      assertEquals(error.getPayload(), {
        status: "error",
        message: "Internal server error",
      });
      assertSpyCalls(log, 1);
      assert(String(log.calls[0].args[0]).includes("database down"));
    });
  });
});
