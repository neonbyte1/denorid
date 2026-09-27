import type { ZodType } from "zod";
import type { RequestContext } from "./request_context.ts";

/**
 * Parsed request inputs by schema, per request context. Written by
 * `ControllerMapping` once a schema declared with `@Body()`, `@Form()`,
 * `@Query()` or `@Params()` validated, read by `RequestContext.validated()`.
 */
export const VALIDATED_INPUTS: WeakMap<
  RequestContext,
  Map<ZodType, unknown>
> = new WeakMap();
