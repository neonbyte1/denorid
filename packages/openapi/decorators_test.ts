import { InvalidStaticMemberDecoratorUsageError } from "@denorid/injector";
import { assertThrows } from "@std/assert";
import { describe, it } from "node:test";
import {
  ApiExclude,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "./decorators.ts";

const METHOD_DECORATORS = {
  ApiTags: ApiTags("tag"),
  ApiOperation: ApiOperation({ summary: "Summary" }),
  ApiResponse: ApiResponse(200),
  ApiSecurity: ApiSecurity("bearer"),
  ApiExclude: ApiExclude(),
};

describe("method decorators", () => {
  for (const [name, decorator] of Object.entries(METHOD_DECORATORS)) {
    it(`@${name}() rejects static methods`, () => {
      assertThrows(
        () => {
          class StaticController {
            @decorator
            public static find(): void {}
          }

          return StaticController;
        },
        InvalidStaticMemberDecoratorUsageError,
      );
    });

    it(`@${name}() rejects #private methods`, () => {
      assertThrows(
        () => {
          class PrivateController {
            @decorator
            #find(): void {}
          }

          return PrivateController;
        },
        Error,
        `Decorator @${name}() cannot be applied to private function "#find"`,
      );
    });
  }
});
