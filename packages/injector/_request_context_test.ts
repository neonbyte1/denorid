import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  getRequestId,
  isInRequestContext,
  runInRequestContext,
} from "./_request_context.ts";
import { RequestScopedService } from "./_test_fixtures.ts";
import { Module } from "./decorators.ts";
import { InjectorContext } from "./injector_context.ts";

describe("Request context utilities", () => {
  it("should provide request context data", async () => {
    @Module({
      providers: [RequestScopedService],
      exports: [RequestScopedService],
    })
    class AppModule {}

    const ctx = await InjectorContext.create(AppModule);

    await ctx.runInRequestScopeAsync("test-request-id", async () => {
      const service = await ctx.resolveInternal(RequestScopedService);
      assertExists(service.id);
    });
  });

  it("should get request id within context", () => {
    let requestId: string | undefined;
    let inContext: boolean = false;

    runInRequestContext("test-req-123", () => {
      requestId = getRequestId();
      inContext = isInRequestContext();
    });

    assertEquals(requestId, "test-req-123");
    assertEquals(inContext, true);
  });

  it("should return undefined outside context", () => {
    assertEquals(getRequestId(), undefined);
    assertEquals(isInRequestContext(), false);
  });
});
