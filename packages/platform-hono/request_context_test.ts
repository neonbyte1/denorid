import type { Context } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { assertSpyCall, spy } from "@std/testing/mock";
import { describe, it } from "node:test";
import { HonoRequestContext } from "./request_context.ts";

describe("HonoRequestContext", () => {
  // deno-lint-ignore no-explicit-any
  type AnyFn = (...args: any[]) => any;

  const makeCtx = (
    req: {
      header: AnyFn;
      queries: AnyFn;
      query: AnyFn;
      param: AnyFn;
      raw?: Request;
    },
    env?: unknown,
  ): Context => ({ req, env } as unknown as Context);

  const makeHeaderFn =
    (values: Record<string, string | undefined>): AnyFn => (key?: string) =>
      key !== undefined ? values[key] : ({} as Record<string, string>);

  describe("constructor", () => {
    it("exposes the dto on the base class", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: () => undefined,
        param: () => ({}),
      });

      const requestCtx = new HonoRequestContext(ctx, "", { id: 42 });

      assertEquals(requestCtx.dto, { id: 42 });
    });

    it("accepts undefined as dto", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: () => undefined,
        param: () => ({}),
      });

      const requestCtx = new HonoRequestContext(ctx, "", undefined);

      assertEquals(requestCtx.dto, undefined);
    });
  });

  describe("headers()", () => {
    it("delegates to ctx.req.header() and returns all headers", () => {
      const expected: Record<string, string> = {
        "x-request-id": "abc",
        "content-type": "application/json",
      };
      const headerSpy = spy(() => expected);
      const ctx = makeCtx({
        header: headerSpy,
        queries: () => ({}),
        query: () => undefined,
        param: () => ({}),
      });

      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const result = requestCtx.headers();

      assertSpyCall(headerSpy, 0, { args: [] });
      assertEquals(result, expected);
    });
  });

  describe("header(key)", () => {
    it("delegates to ctx.req.header(key) and returns the value", () => {
      const headerSpy = spy((_key: string) => "Bearer token");
      const ctx = makeCtx({
        header: headerSpy,
        queries: () => ({}),
        query: () => undefined,
        param: () => ({}),
      });

      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const result = requestCtx.header("authorization");

      assertSpyCall(headerSpy, 0, { args: ["authorization"] });
      assertEquals(result, "Bearer token");
    });

    it("returns undefined when the header is absent", () => {
      const ctx = makeCtx({
        header: () => undefined,
        queries: () => ({}),
        query: () => undefined,
        param: () => ({}),
      });

      const requestCtx = new HonoRequestContext(ctx, "", undefined);

      assertEquals(requestCtx.header("x-missing"), undefined);
    });
  });

  describe("ip", () => {
    const noopReq = {
      queries: () => ({}),
      query: () => undefined,
      param: () => ({}),
    };

    it("defaults to the socket peer address and ignores forwarding headers", () => {
      const ctx = makeCtx(
        {
          ...noopReq,
          header: makeHeaderFn({
            "cf-connecting-ip": "203.0.113.1",
            "x-forwarded-for": "203.0.113.2",
            "x-real-ip": "203.0.113.3",
          }),
        },
        { remoteAddr: { hostname: "10.0.0.1", port: 80, transport: "tcp" } },
      );
      const requestCtx = new HonoRequestContext(ctx, "", undefined);

      assertEquals(requestCtx.ip, "10.0.0.1");
    });

    it("resolves the address with the given resolver", () => {
      const ctx = makeCtx({ ...noopReq, header: () => undefined });
      const resolveIp = spy((_ctx: Context) => "203.0.113.9");
      const requestCtx = new HonoRequestContext(ctx, "", undefined, resolveIp);

      assertEquals(requestCtx.ip, "203.0.113.9");
      assertSpyCall(resolveIp, 0, { args: [ctx] });
    });
  });

  describe("queries()", () => {
    it("delegates to ctx.req.queries() and returns all query params", () => {
      const expected: Record<string, string[]> = {
        tag: ["a", "b"],
        page: ["1"],
      };
      const queriesSpy = spy(() => expected);
      const ctx = makeCtx({
        header: () => ({}),
        queries: queriesSpy,
        query: () => undefined,
        param: () => ({}),
      });

      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const result = requestCtx.queries();

      assertSpyCall(queriesSpy, 0, { args: [] });
      assertEquals(result, expected);
    });
  });

  describe("queries(key)", () => {
    it("returns the values array for the given key", () => {
      const queriesSpy = spy((_key: string) => ["x", "y"]);
      const ctx = makeCtx({
        header: () => ({}),
        queries: queriesSpy,
        query: () => undefined,
        param: () => ({}),
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const result = requestCtx.queries("tag");

      assertSpyCall(queriesSpy, 0, { args: ["tag"] });
      assertEquals(result, ["x", "y"]);
    });

    it("returns an empty array when the key is absent", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => undefined,
        query: () => undefined,
        param: () => ({}),
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);

      assertEquals(requestCtx.queries("missing"), []);
    });
  });

  describe("queries(key, transformer)", () => {
    it("transforms each value with a PipeTransformFn", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: (_key: string) => ["1", "2", "3"],
        query: () => undefined,
        param: () => ({}),
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const transformSpy = spy((v: string) => parseInt(v, 10));
      const result = requestCtx.queries("page", transformSpy);

      assertSpyCall(transformSpy, 0, {
        args: ["1", { type: "query", data: "page" }],
      });
      assertSpyCall(transformSpy, 1, {
        args: ["2", { type: "query", data: "page" }],
      });
      assertSpyCall(transformSpy, 2, {
        args: ["3", { type: "query", data: "page" }],
      });
      assertEquals(result, [1, 2, 3]);
    });

    it("transforms each value with a PipeTransform object", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: (_key: string) => ["10", "20"],
        query: () => undefined,
        param: () => ({}),
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const transformer = { transform: spy((v: string) => parseInt(v, 10)) };
      const result = requestCtx.queries("amount", transformer);

      assertSpyCall(transformer.transform, 0, {
        args: ["10", { type: "query", data: "amount" }],
      });
      assertSpyCall(transformer.transform, 1, {
        args: ["20", { type: "query", data: "amount" }],
      });
      assertEquals(result, [10, 20]);
    });

    it("returns an empty array when the key is absent and a transformer is provided", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => null,
        query: () => undefined,
        param: () => ({}),
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const transformSpy = spy((v: string) => parseInt(v, 10));
      const result = requestCtx.queries("missing", transformSpy);

      assertEquals(result, []);
      assertEquals(transformSpy.calls.length, 0);
    });
  });

  describe("query(key)", () => {
    it("delegates to ctx.req.query(key) and returns the value", () => {
      const querySpy = spy((_key: string) => "hello");
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: querySpy,
        param: () => ({}),
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const result = requestCtx.query("q");

      assertSpyCall(querySpy, 0, { args: ["q"] });
      assertEquals(result, "hello");
    });

    it("returns undefined when the query param is absent", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: () => undefined,
        param: () => ({}),
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);

      assertEquals(requestCtx.query("missing"), undefined);
    });
  });

  describe("query(key, transformer)", () => {
    it("transforms the value with a PipeTransformFn", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: () => "42",
        param: () => ({}),
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const transformSpy = spy((v: string) => parseInt(v, 10));
      const result = requestCtx.query("page", transformSpy);

      assertSpyCall(transformSpy, 0, {
        args: ["42", { type: "query", data: "page" }],
      });
      assertEquals(result, 42);
    });

    it("transforms the value with a PipeTransform object", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: () => "7",
        param: () => ({}),
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const transformer = { transform: spy((v: string) => parseInt(v, 10)) };
      const result = requestCtx.query("count", transformer);

      assertSpyCall(transformer.transform, 0, {
        args: ["7", { type: "query", data: "count" }],
      });
      assertEquals(result, 7);
    });
  });

  describe("params()", () => {
    it("delegates to ctx.req.param() and returns all path params", () => {
      const expected: Record<string, string> = {
        id: "123",
        slug: "hello-world",
      };
      const paramSpy = spy(() => expected);
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: () => undefined,
        param: paramSpy,
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const result = requestCtx.params();

      assertSpyCall(paramSpy, 0, { args: [] });
      assertEquals(result, expected);
    });
  });

  describe("param(key)", () => {
    it("delegates to ctx.req.param(key) and returns the value", () => {
      const paramSpy = spy((_key: string) => "99");
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: () => undefined,
        param: paramSpy,
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const result = requestCtx.param("id");

      assertSpyCall(paramSpy, 0, { args: ["id"] });
      assertEquals(result, "99");
    });

    it("returns undefined when the param is absent", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: () => undefined,
        param: () => undefined,
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);

      assertEquals(requestCtx.param("missing"), undefined);
    });
  });

  describe("param(key, transformer)", () => {
    it("transforms the value with a PipeTransformFn", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: () => undefined,
        param: () => "5",
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const transformSpy = spy((v: string) => parseInt(v, 10));
      const result = requestCtx.param("id", transformSpy);

      assertSpyCall(transformSpy, 0, {
        args: ["5", { type: "param", data: "id" }],
      });
      assertEquals(result, 5);
    });

    it("transforms the value with a PipeTransform object", () => {
      const ctx = makeCtx({
        header: () => ({}),
        queries: () => ({}),
        query: () => undefined,
        param: () => "3",
      });
      const requestCtx = new HonoRequestContext(ctx, "", undefined);
      const transformer = { transform: spy((v: string) => parseInt(v, 10)) };
      const result = requestCtx.param("id", transformer);

      assertSpyCall(transformer.transform, 0, {
        args: ["3", { type: "param", data: "id" }],
      });
      assertEquals(result, 3);
    });
  });
});
