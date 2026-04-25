import type { RequestContext } from "@denorid/core";
import { ContextNotAvailableException } from "@denorid/core";
import type { Context } from "@hono/hono";
import { assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { HonoHostArguments } from "./host_arguments.ts";
import { HonoRequestContext } from "./request_context.ts";

describe(HonoRequestContext.name, () => {
  describe("switchToRpc()", () => {
    it("ensure method throws exception", () => {
      assertThrows(
        () =>
          new HonoHostArguments(
            undefined as unknown as Context,
            undefined as unknown as RequestContext,
          ).switchToRpc(),
        ContextNotAvailableException,
      );
    });
  });
});
