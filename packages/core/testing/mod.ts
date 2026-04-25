/**
 * @module
 *
 * Testing utilities for Denorid - create isolated DI contexts, override providers,
 * and auto-mock missing dependencies in unit and integration tests.
 *
 * @example
 * ```ts
 * import { Test } from "@denorid/core/testing";
 *
 * const module = await Test.createTestingModule({
 *   providers: [MyService],
 * })
 *   .useMocker((token) => ({ mock: true, token }))
 *   .compile();
 *
 * const svc = await module.get(MyService);
 * ```
 */
export * from "./mock_factory.ts";
export * from "./testing_module.ts";
export * from "./testing_module_builder.ts";
