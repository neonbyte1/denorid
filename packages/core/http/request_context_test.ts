import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, spy } from "@std/testing/mock";
import type {
  PipeTransform,
  PipeTransformFn,
} from "../pipes/pipe_transform.ts";
import { RequestContext } from "./request_context.ts";

describe("abstract RequestContext class", () => {
  class TestRequestContext extends RequestContext {
    public constructor() {
      super(undefined);
    }

    public override headers(): Record<string, string> {
      throw new Error("Method not implemented");
    }

    public override header(_key: string): string | undefined {
      throw new Error("Method not implemented");
    }

    public override params(): Record<string, string> {
      throw new Error("Method not implemented");
    }

    public override param(key: string): string | undefined;
    public override param<T>(
      key: string,
      transformer: PipeTransform<T> | PipeTransformFn<T>,
    ): T;
    public override param<T>(
      _key: string,
      _transformer?: PipeTransform<T> | PipeTransformFn<T>,
    ): string | T | undefined {
      throw new Error("Method not implemented");
    }

    public override queries(): Record<string, string[]>;
    public override queries(key: string): string[];
    public override queries<T>(
      key: string,
      transformer: PipeTransform<T> | PipeTransformFn<T>,
    ): T[];
    public override queries<T>(
      _key?: string,
      _transformer?: PipeTransform<T> | PipeTransformFn<T>,
    ): Record<string, string[]> | string[] | T[] {
      throw new Error("Method not implemented");
    }

    public override query(key: string): string | undefined;
    public override query<T>(
      key: string,
      transformer: PipeTransform<T> | PipeTransformFn<T>,
    ): T;
    public override query<T>(
      _key: string,
      _transformer?: PipeTransform<T> | PipeTransformFn<T>,
    ): string | T | undefined {
      throw new Error("Method not implemented");
    }
  }

  describe("transform", () => {
    const ctx = new TestRequestContext();

    it("ensure passed function is being used", () => {
      const transformSpy = spy(<T>(_value: string | null | undefined): T =>
        undefined as unknown as T
      );

      ctx["transform"]("1337", transformSpy, {
        type: "param",
        data: "id",
      });

      assertSpyCall(transformSpy, 0);
    });

    it("ensure passed interface is being used", () => {
      const transformer = {
        transform: spy((_: string): unknown => undefined),
      };

      ctx["transform"]("1", transformer, {
        type: "query",
        data: "page",
      });

      assertSpyCall(transformer.transform, 0);
    });
  });
});
