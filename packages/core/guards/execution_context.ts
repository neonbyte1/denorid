import type { Type } from "@denorid/injector";
import type { HostArguments } from "../host_arguments.ts";
import type {
  HttpController,
  HttpRouteFn,
} from "../http/controller_mapping.ts";

/**
 * Interface describing details about the current request pipeline.
 */
export interface ExecutionContext extends HostArguments {
  /**
   * Gets the *type* of the controller class which the current handler belongs to.
   *
   * @template T Controller class type
   *
   * @returns {Type<T>} Constructor of the controller class.
   */
  getClass<T = HttpController>(): Type<T>;

  /**
   * Gets a reference to the handler (method) that will be invoked next in the request pipeline.
   *
   * @returns {HttpRouteFn} Reference of the handler (method).
   */
  getHandler(): HttpRouteFn;
}
