import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { SimpleService } from "./_test_fixtures.ts";
import {
  CircularDependencyError,
  InjectionError,
  InvalidProviderError,
  LifecycleError,
  ModuleCompilationError,
  RequestContextError,
  TokenNotFoundError,
} from "./errors.ts";

describe("Errors", () => {
  it("InjectionError should have correct name", () => {
    const error = new InjectionError("test");

    assertEquals(error.name, "InjectionError");
    assertEquals(error.message, "test");
  });

  it("CircularDependencyError should format chain", () => {
    const error = new CircularDependencyError([
      SimpleService,
      "TOKEN",
      SimpleService,
    ]);

    assert(error.message.includes("->"));
    assertEquals(error.name, "CircularDependencyError");
  });

  it("TokenNotFoundError should include token info", () => {
    const error = new TokenNotFoundError(SimpleService);

    assert(error.message.includes("SimpleService"));
    assertEquals(error.name, "TokenNotFoundError");
  });

  it("ModuleCompilationError should have correct name", () => {
    const error = new ModuleCompilationError("test");

    assertEquals(error.name, "ModuleCompilationError");
  });

  it("RequestContextError should include token info", () => {
    const error = new RequestContextError(SimpleService);

    assert(error.message.includes("SimpleService"));
    assertEquals(error.name, "RequestContextError");
  });

  it("LifecycleError should format multiple errors", () => {
    const errors = [new Error("error1"), new Error("error2")];
    const error = new LifecycleError("onModuleInit", errors);

    assert(error.message.includes("2 error"));
    assert(error.message.includes("error1"));
    assertEquals(error.name, "LifecycleError");
  });

  it("InvalidProviderError should stringify provider", () => {
    const error = new InvalidProviderError({ foo: "bar" });

    assert(error.message.includes("foo"));
    assertEquals(error.name, "InvalidProviderError");
  });

  it("should handle symbol tokens in errors", () => {
    const sym = Symbol("MY_SYM");
    const error = new TokenNotFoundError(sym);

    assert(error.message.includes("Symbol"));
  });

  it("should handle anonymous class in errors", () => {
    const AnonClass = (() => class {})();

    Object.defineProperty(AnonClass, "name", { value: "" });

    const error = new TokenNotFoundError(AnonClass);

    assert(error.message.includes("anonymous"));
  });
});
