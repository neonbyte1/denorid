import { type Decorator, Injectable, Tags, type Type } from "@denorid/injector";
import {
  CONTROLLER_METADATA,
  HTTP_CONTROLLER_METADATA,
} from "../_constants.ts";
import type { ControllerOptions } from "./controller_options.ts";

/**
 * Marks a class as an HTTP controller mounted at `"/"`.
 *
 * The class is registered with `@Injectable` (singleton scope) and tagged
 * with `HTTP_CONTROLLER_METADATA` for discovery by {@link ControllerMapping}.
 *
 * @return {Decorator<ClassDecoratorContext, Type>} The class decorator.
 */
export function Controller(): Decorator<ClassDecoratorContext, Type>;
/**
 * Marks a class as an HTTP controller with one or more base path prefixes.
 *
 * @param {string | string[]} prefix - Base path(s) prepended to every route in this controller.
 * @return {Decorator<ClassDecoratorContext, Type>} The class decorator.
 */
export function Controller(
  prefix: string | string[],
): Decorator<ClassDecoratorContext, Type>;
/**
 * Marks a class as an HTTP controller using a full options object.
 *
 * @param {ControllerOptions} options - Configuration options including path and injection mode.
 * @return {Decorator<ClassDecoratorContext, Type>} The class decorator.
 */
export function Controller(
  options: ControllerOptions,
): Decorator<ClassDecoratorContext, Type>;
export function Controller(
  arg?: string | string[] | ControllerOptions,
): Decorator<ClassDecoratorContext, Type> {
  return (target: Type, ctx: ClassDecoratorContext): void => {
    const options: ControllerOptions = typeof arg === "string"
      ? { path: arg }
      : Array.isArray(arg)
      ? { path: arg }
      : arg ?? { path: "/" };

    Injectable({ mode: options.mode ?? "singleton" })(target, ctx);
    Tags(HTTP_CONTROLLER_METADATA)(target, ctx);

    ctx.metadata[CONTROLLER_METADATA] = options;
  };
}
